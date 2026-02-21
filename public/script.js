const query = new URLSearchParams(window.location.search);
const runId = query.get("run_id") || `local-${Date.now()}`;
const eventCode = query.get("event_code") || "local-event";
const scenarioId = query.get("scenario_id") || "";

const socket = io({
  transports: ["websocket", "polling"],
  upgrade: true,
  autoConnect: false,
  query: { role: "player", scenario_id: scenarioId, event_code: eventCode, run_id: runId || "" },
});

const TAB_ORDER = ["equities", "commodities", "bonds"];
const TAB_LABELS = { equities: "Equities", commodities: "Commodities", bonds: "Bonds" };

const runErrorView = document.getElementById("runErrorView");
const runErrorTitle = runErrorView?.querySelector("h2");
const runErrorDetail = runErrorView?.querySelector("p.muted");
const gameDateBadge = document.getElementById("gameDateBadge");
const newsFeed = document.getElementById("newsFeed");
const macroFeed = document.getElementById("macroFeed");
const joinView = document.getElementById("joinView");
const waitView = document.getElementById("waitView");
const gameView = document.getElementById("gameView");
const rosterList = document.getElementById("roster");
const nameInput = document.getElementById("nameInput");
const joinBtn = document.getElementById("joinBtn");
const joinMsg = document.getElementById("joinMsg");
const connectionBadge = document.getElementById("connectionBadge");
const posLbl = document.getElementById("posLbl");
const cashLbl = document.getElementById("cashLbl");
const openPnlLbl = document.getElementById("openPnlLbl");
const pnlLbl = document.getElementById("pnlLbl");
const assetsList = document.getElementById("assetsList");
const assetTabs = document.getElementById("assetTabs");
const assetSubheading = document.getElementById("assetSubheading");
const orderAssetLabel = document.getElementById("orderAssetLabel");
const buyBtn = document.getElementById("buyBtn");
const sellBtn = document.getElementById("sellBtn");
const quantityInput = document.getElementById("quantityInput");
const fullscreenButtons = Array.from(document.querySelectorAll("[data-fullscreen]"));


const chartContainer = document.getElementById("chart");
let chartApi = null;
let candleSeriesApi = null;
let avgPriceLineCandle = null;
let chartResizeObserver = null;

let assets = [];
let assetMap = new Map();
let selectedAssetId = null;
let activeTab = "equities";
let positions = new Map();
let availableCash = 100000;
let totalPnlValue = 0;
let highestEquity = availableCash;
let maxDrawdown = 0;
let currentPhase = "lobby";
let hasJoined = false;
let macroEvents = [];
let currentTick = 0;
let simStartMs = null;
let tickMs = 500;


function formatGameTime(gameTimeMs) {
  if (!Number.isFinite(gameTimeMs)) return "—";
  return new Date(gameTimeMs).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function updateGameDateDisplay(gameTimeMs = null) {
  if (!gameDateBadge) return;
  const resolved = Number.isFinite(gameTimeMs)
    ? gameTimeMs
    : Number.isFinite(simStartMs)
      ? simStartMs + currentTick * tickMs
      : null;
  gameDateBadge.textContent = `Game Time: ${formatGameTime(resolved)}`;
}

function show(node) {
  if (node) node.classList.remove("hidden");
}

function hide(node) {
  if (node) node.classList.add("hidden");
}

function showLaunchError(title, detail) {
  if (runErrorTitle) runErrorTitle.textContent = title;
  if (runErrorDetail) runErrorDetail.textContent = detail;
  hide(joinView);
  hide(waitView);
  hide(gameView);
  show(runErrorView);
}

async function validateScenario() {
  if (!scenarioId) return null;
  try {
    const response = await fetch(`/scenarios/${encodeURIComponent(scenarioId)}.json`, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function pushNewsItem(headline, tick, category = "general") {
  if (!newsFeed || !headline || category !== "general") return;
  const item = document.createElement("div");
  item.className = "news-item";
  item.innerHTML = `<strong>T+${tick ?? "—"}s</strong><span class="muted">${headline}</span>`;
  newsFeed.prepend(item);
}

function renderMacroEvents() {
  if (!macroFeed) return;
  macroFeed.innerHTML = "";

  const sorted = [...macroEvents].sort((a, b) => {
    const aTick = a.status === "actual" ? a.actualTick : a.expectationTick;
    const bTick = b.status === "actual" ? b.actualTick : b.expectationTick;
    return bTick - aTick;
  });

  if (!sorted.length) {
    const placeholder = document.createElement("div");
    placeholder.className = "macro-item";
    placeholder.innerHTML = `<strong>Calendar feed</strong><span class="muted">Waiting for the first expectation release...</span>`;
    macroFeed.appendChild(placeholder);
    return;
  }

  sorted.forEach((event) => {
    const item = document.createElement("div");
    item.className = "macro-item";

    const flashWindow = event.status === "expected" && Number(event.actualTick) - Number(currentTick) <= 10 && Number(event.actualTick) - Number(currentTick) >= 0;
    if (flashWindow) item.classList.add("flash-alert");

    const statusLine =
      event.status === "actual"
        ? `<span class="macro-status actual">Actual (tick ${event.actualTick})</span><span>${event.actual}</span>`
        : `<span class="macro-status expected">Expected (tick ${event.expectationTick})</span><span>${event.expected}</span>`;

    item.innerHTML = `<strong>${event.label}</strong>${statusLine}`;
    macroFeed.appendChild(item);
  });

}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return Number(value).toFixed(digits);
}

function formatCurrency(value) {
  if (!Number.isFinite(value)) return "—";
  return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSignedCurrency(value) {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatCurrency(Math.abs(value))}`;
}

function getPositionData(assetId) {
  return positions.get(assetId) || { position: 0, avgCost: 0, realizedPnl: 0 };
}

function hasActivePosition(assetId) {
  return Math.abs(getPositionData(assetId).position || 0) > 0;
}

function pnlForAsset(asset) {
  const posData = getPositionData(asset.id);
  const unrealized = posData.position ? (asset.price - posData.avgCost) * posData.position : 0;
  return (posData.realizedPnl || 0) + unrealized;
}

function updatePortfolioSummary() {
  let totalPnl = 0;
  let openPnl = 0;
  let positionValue = 0;

  positions.forEach((posData, assetId) => {
    const asset = assetMap.get(assetId);
    const price = asset?.price ?? 0;
    const unrealized = posData.position ? (price - posData.avgCost) * posData.position : 0;
    const realized = posData.realizedPnl || 0;
    totalPnl += realized + unrealized;
    openPnl += unrealized;
    positionValue += Math.abs(posData.position) * price;
  });

  totalPnlValue = totalPnl;
  highestEquity = Math.max(highestEquity, availableCash + totalPnlValue);
  maxDrawdown = Math.max(maxDrawdown, highestEquity - (availableCash + totalPnlValue));

  posLbl.textContent = formatCurrency(positionValue);
  if (cashLbl) cashLbl.textContent = formatCurrency(availableCash);
  if (openPnlLbl) {
    openPnlLbl.textContent = formatSignedCurrency(openPnl);
    openPnlLbl.classList.toggle("positive", openPnl > 0);
    openPnlLbl.classList.toggle("negative", openPnl < 0);
  }
  if (pnlLbl) {
    pnlLbl.textContent = formatSignedCurrency(totalPnl);
    pnlLbl.classList.toggle("positive", totalPnl > 0);
    pnlLbl.classList.toggle("negative", totalPnl < 0);
  }
}

function createAssetRow(asset) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "asset-row";
  row.dataset.asset = asset.id;

  const symbol = document.createElement("span");
  symbol.className = "asset-symbol";
  symbol.textContent = asset.symbol;

  const price = document.createElement("span");
  price.className = "asset-price";
  price.textContent = formatNumber(asset.price, asset.isYield ? 3 : 2);

  const position = document.createElement("span");
  position.className = "asset-position";
  position.textContent = "0";

  const pnl = document.createElement("span");
  pnl.className = "asset-pnl";
  pnl.textContent = "0.00";

  row.append(symbol, price, position, pnl);
  row.addEventListener("click", () => selectAsset(asset.id));
  return row;
}

function sortAssetsWithPositionsFirst(items) {
  return [...items]
    .map((asset, index) => ({ asset, index }))
    .sort((a, b) => {
      const aPinned = hasActivePosition(a.asset.id) ? 0 : 1;
      const bPinned = hasActivePosition(b.asset.id) ? 0 : 1;
      if (aPinned !== bPinned) return aPinned - bPinned;
      return a.index - b.index;
    })
    .map((entry) => entry.asset);
}

function renderAssetTabs() {
  if (!assetTabs) return;
  assetTabs.innerHTML = "";
  TAB_ORDER.forEach((tab) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "asset-tab";
    btn.textContent = TAB_LABELS[tab];
    btn.dataset.tab = tab;
    btn.classList.toggle("active", activeTab === tab);
    btn.addEventListener("click", () => {
      activeTab = tab;
      renderAssetTabs();
      renderAssetsList();
    });
    assetTabs.appendChild(btn);
  });
}

function renderAssetsList() {
  assetsList.innerHTML = "";
  const categoryAssets = sortAssetsWithPositionsFirst(assets.filter((asset) => (asset.category || "equities") === activeTab));

  if (activeTab === "equities") {
    const stocks = categoryAssets.filter((asset) => asset.group !== "indices");
    const indices = categoryAssets.filter((asset) => asset.group === "indices");

    const sections = [
      { title: "Stocks", rows: stocks },
      { title: "Indices", rows: indices },
    ];

    sections.forEach((section) => {
      if (!section.rows.length) return;
      const heading = document.createElement("div");
      heading.className = "asset-subsection";
      heading.textContent = section.title;
      assetsList.appendChild(heading);
      section.rows.forEach((asset) => assetsList.appendChild(createAssetRow(asset)));
    });

    if (assetSubheading) assetSubheading.textContent = "Stocks + Indices";
  } else {
    categoryAssets.forEach((asset) => assetsList.appendChild(createAssetRow(asset)));
    if (assetSubheading) assetSubheading.textContent = TAB_LABELS[activeTab];
  }

  updateAssetsListValues();
}

function updateAssetsListValues() {
  assets.forEach((asset) => {
    const row = assetsList.querySelector(`[data-asset="${asset.id}"]`);
    if (!row) return;

    const posData = getPositionData(asset.id);
    const pnlData = pnlForAsset(asset);

    row.querySelector(".asset-price").textContent = formatNumber(asset.price, asset.isYield ? 3 : 2);
    row.querySelector(".asset-position").textContent = String(posData.position.toFixed(0));

    const pnlCell = row.querySelector(".asset-pnl");
    pnlCell.textContent = formatSignedCurrency(pnlData);
    pnlCell.classList.toggle("positive", pnlData > 0);
    pnlCell.classList.toggle("negative", pnlData < 0);

    const hasPosition = Math.abs(posData.position || 0) > 0;
    row.classList.toggle("has-position", hasPosition);
    row.classList.toggle("active", asset.id === selectedAssetId);
  });

  updatePortfolioSummary();
}

function ensureChart() {
  if (chartApi || !chartContainer) return;
  chartApi = LightweightCharts.createChart(chartContainer, {
    layout: { background: { color: "#0d1423" }, textColor: "#e7efff" },
    grid: { vertLines: { color: "#1b2b45" }, horzLines: { color: "#1b2b45" } },
    timeScale: { borderColor: "#1b2b45", timeVisible: true },
    rightPriceScale: { borderColor: "#1b2b45" },
  });

  candleSeriesApi = chartApi.addCandlestickSeries({
    upColor: "#2ecc71",
    downColor: "#ff5c5c",
    borderUpColor: "#2ecc71",
    borderDownColor: "#ff5c5c",
    wickUpColor: "#2ecc71",
    wickDownColor: "#ff5c5c",
  });

  chartResizeObserver = new ResizeObserver(() => {
    chartApi?.applyOptions({ width: chartContainer.clientWidth, height: chartContainer.clientHeight });
  });
  chartResizeObserver.observe(chartContainer);
}

function updateAverageLine(asset) {
  if (!candleSeriesApi) return;
  if (avgPriceLineCandle) {
    candleSeriesApi.removePriceLine(avgPriceLineCandle);
    avgPriceLineCandle = null;
  }

  const posData = getPositionData(asset.id);
  if (!posData.position) return;

  avgPriceLineCandle = candleSeriesApi.createPriceLine({
    price: posData.avgCost,
    color: "#f5c542",
    lineWidth: 2,
    title: "Avg",
  });
}

function selectAsset(assetId) {
  const asset = assetMap.get(assetId);
  if (!asset) return;

  selectedAssetId = assetId;
  orderAssetLabel.textContent = asset.symbol;
  activeTab = asset.category || activeTab;
  renderAssetTabs();
  renderAssetsList();

  ensureChart();
  const candleData = [...(asset.candles || [])];
  if (asset.candle) candleData.push(asset.candle);
  candleSeriesApi?.setData(candleData);
  if (chartApi) {
    chartApi.timeScale().fitContent();
    chartApi.timeScale().scrollToRealTime();
  }
  updateAverageLine(asset);
}

function updateChartForAsset(asset) {
  if (!candleSeriesApi || selectedAssetId !== asset.id) return;
  if (asset.completedCandle) candleSeriesApi.update(asset.completedCandle);
  if (asset.candle) candleSeriesApi.update(asset.candle);
}

function renderRoster(players = []) {
  if (!rosterList) return;
  rosterList.innerHTML = "";
  players.forEach((player) => {
    const item = document.createElement("li");
    item.textContent = player.name || "Player";
    rosterList.appendChild(item);
  });
}

function refreshViewForPhase() {
  if (!hasJoined) {
    show(joinView);
    hide(waitView);
    hide(gameView);
    return;
  }

  if (currentPhase === "running") {
    hide(joinView);
    hide(waitView);
    show(gameView);
    return;
  }

  hide(joinView);
  show(waitView);
  hide(gameView);
}

function setPhase(phase) {
  currentPhase = String(phase || "lobby").toLowerCase();
  const marketOpen = currentPhase === "running";
  if (buyBtn) buyBtn.disabled = !marketOpen;
  if (sellBtn) sellBtn.disabled = !marketOpen;
  refreshViewForPhase();
}

function handleOrder(side) {
  if (!selectedAssetId) return;
  if (currentPhase !== "running") return;

  const qty = Number(quantityInput.value || 0);
  socket.emit("submitOrder", { assetId: selectedAssetId, side, qty, type: "market" });
}

socket.on("connect", () => {
  if (connectionBadge) {
    connectionBadge.dataset.state = "connected";
    connectionBadge.textContent = "Connected";
  }
});

socket.on("disconnect", () => {
  if (connectionBadge) {
    connectionBadge.dataset.state = "disconnected";
    connectionBadge.textContent = "Disconnected";
  }
});

socket.on("phase", setPhase);

socket.on("assetSnapshot", (payload) => {
  tickMs = Number(payload?.tickMs || tickMs);
  currentTick = Number(payload?.tick || currentTick);
  if (Number.isFinite(payload?.simStartMs)) simStartMs = Number(payload.simStartMs);
  else if (Array.isArray(payload?.assets) && Number.isFinite(payload.assets[0]?.simStartMs)) simStartMs = Number(payload.assets[0].simStartMs);

  assets = payload.assets || [];
  assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  renderAssetTabs();
  renderAssetsList();
  updateGameDateDisplay();
  if (!selectedAssetId && assets.length) {
    const preferred = assets.find((asset) => asset.category === activeTab) || assets[0];
    selectAsset(preferred.id);
  }
});

socket.on("assetTick", (payload) => {
  currentTick = Number(payload?.tick || currentTick);
  updateGameDateDisplay();
  (payload.assets || []).forEach((update) => {
    const asset = assetMap.get(update.id);
    if (!asset) return;
    asset.price = update.price;
    asset.candle = update.candle;
    asset.completedCandle = update.completedCandle;
    if (update.completedCandle) {
      asset.candles.push(update.completedCandle);
      if (asset.candles.length > 80) asset.candles.shift();
    }
    updateChartForAsset(asset);
  });
  updateAssetsListValues();
  if (selectedAssetId) updateAverageLine(assetMap.get(selectedAssetId));
});

socket.on("portfolio", (payload) => {
  positions = new Map();
  (payload?.positions || []).forEach((item) => {
    positions.set(item.assetId, {
      position: item.position,
      avgCost: item.avgCost,
      realizedPnl: item.realizedPnl ?? 0,
    });
  });
  if (Number.isFinite(payload?.cash)) availableCash = payload.cash;
  renderAssetsList();
  updateAssetsListValues();
});

socket.on("news", (payload) => {
  pushNewsItem(payload?.headline, payload?.tick, payload?.category);
});

socket.on("macroEvents", (payload) => {
  currentTick = Number(payload?.tick || 0);
  if (Number.isFinite(payload?.gameTimeMs)) updateGameDateDisplay(Number(payload.gameTimeMs));
  else updateGameDateDisplay();
  macroEvents = Array.isArray(payload?.events) ? payload.events : [];
  renderMacroEvents();
});

socket.on("roster", (payload) => {
  renderRoster(payload?.players || []);
});

socket.on("scenarioError", (payload) => {
  showLaunchError("Scenario not found.", payload?.message || "Scenario not found.");
});

buyBtn?.addEventListener("click", () => handleOrder("buy"));
sellBtn?.addEventListener("click", () => handleOrder("sell"));

joinBtn?.addEventListener("click", () => {
  const name = nameInput.value.trim();
  if (!name) {
    joinMsg.textContent = "Enter a name to join.";
    return;
  }

  socket.emit("join", { name, runId, eventCode, scenarioId }, (res) => {
    if (!res?.ok) {
      joinMsg.textContent = "Unable to join.";
      return;
    }
    hasJoined = true;
    setPhase(res.phase);
    renderRoster(res.players || []);
    refreshViewForPhase();
  });
});



function fullscreenSupported() {
  return Boolean(document.documentElement?.requestFullscreen);
}

function updateFullscreenButtons() {
  const active = Boolean(document.fullscreenElement);
  fullscreenButtons.forEach((btn) => {
    btn.dataset.active = String(active);
    btn.textContent = active ? "Exit Fullscreen" : "Enter Fullscreen";
  });
}

function toggleFullscreen() {
  if (!fullscreenSupported()) return;
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
    return;
  }
  document.documentElement.requestFullscreen?.();
}

fullscreenButtons.forEach((btn) => {
  btn.addEventListener("click", toggleFullscreen);
});

document.addEventListener("fullscreenchange", updateFullscreenButtons);

async function init() {
  await validateScenario();

  updateFullscreenButtons();
  socket.connect();
  updatePortfolioSummary();
  updateGameDateDisplay();
  refreshViewForPhase();
}

init();
