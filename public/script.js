const query = new URLSearchParams(window.location.search);
const runId = query.get("run_id");
const eventCode = query.get("event_code") || "";
const scenarioId = query.get("scenario_id") || "global-macro";

const socket = io({
  transports: ["websocket", "polling"],
  upgrade: true,
  autoConnect: false,
  query: { role: "player", scenario_id: scenarioId, event_code: eventCode, run_id: runId || "" },
});

const backendUrl = import.meta.env?.VITE_BACKEND_URL || window.APP_CONFIG?.VITE_BACKEND_URL || "";
const mintUrl = import.meta.env?.VITE_MINT_URL || window.APP_CONFIG?.VITE_MINT_URL || "";
const isDebugSubmissionEnabled =
  import.meta.env?.DEV ||
  window.APP_CONFIG?.NODE_ENV !== "production" ||
  query.get("debug_submit") === "1";

const TAB_ORDER = ["equities", "commodities", "bonds"];
const TAB_LABELS = { equities: "Equities", commodities: "Commodities", bonds: "Bonds" };

const runErrorView = document.getElementById("runErrorView");
const mintHomeLink = document.getElementById("mintHomeLink");
const runErrorTitle = runErrorView?.querySelector("h2");
const runErrorDetail = runErrorView?.querySelector("p.muted");
const scenarioLabel = document.getElementById("scenarioLabel");
const newsFeed = document.getElementById("newsFeed");
const joinView = document.getElementById("joinView");
const waitView = document.getElementById("waitView");
const gameView = document.getElementById("gameView");
const nameInput = document.getElementById("nameInput");
const joinBtn = document.getElementById("joinBtn");
const joinMsg = document.getElementById("joinMsg");
const connectionBadge = document.getElementById("connectionBadge");
const phaseBadge = document.getElementById("phaseBadge");
const posLbl = document.getElementById("posLbl");
const cashLbl = document.getElementById("cashLbl");
const openPnlLbl = document.getElementById("openPnlLbl");
const pnlLbl = document.getElementById("pnlLbl");
const assetsList = document.getElementById("assetsList");
const assetTabs = document.getElementById("assetTabs");
const assetSubheading = document.getElementById("assetSubheading");
const orderAssetLabel = document.getElementById("orderAssetLabel");
const resultMessage = document.getElementById("resultMessage");
const resultActions = document.getElementById("resultActions");
const runIdLabel = document.getElementById("runIdLabel");
const submitTestBtn = document.getElementById("submitTestBtn");
const buyBtn = document.getElementById("buyBtn");
const sellBtn = document.getElementById("sellBtn");
const quantityInput = document.getElementById("quantityInput");
const tradeStatus = document.getElementById("tradeStatus");
const openOrdersList = document.getElementById("openOrders");

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
let openOrders = [];
let availableCash = 100000;
let totalPnlValue = 0;
let highestEquity = availableCash;
let maxDrawdown = 0;
let winTrades = 0;
let totalTrades = 0;
let hasSubmittedRun = false;
let latestSubmissionPayload = null;
let currentPhase = "running";

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
  try {
    const response = await fetch(`/scenarios/${encodeURIComponent(scenarioId)}.json`, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function pushNewsItem(headline, tick) {
  if (!newsFeed || !headline) return;
  const item = document.createElement("div");
  item.className = "news-item";
  item.innerHTML = `<strong>T+${tick ?? "—"}s</strong><span class="muted">${headline}</span>`;
  newsFeed.prepend(item);
  while (newsFeed.children.length > 6) newsFeed.removeChild(newsFeed.lastElementChild);
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

function setTradeStatus(message, tone = "") {
  if (!tradeStatus) return;
  tradeStatus.textContent = message;
  tradeStatus.dataset.tone = tone;
}

function getPositionData(assetId) {
  return positions.get(assetId) || { position: 0, avgCost: 0, realizedPnl: 0 };
}

function pnlForAsset(asset) {
  const posData = getPositionData(asset.id);
  const unrealized = posData.position ? (asset.price - posData.avgCost) * posData.position : 0;
  const realized = posData.realizedPnl || 0;
  return realized + unrealized;
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
  if (openPnlLbl) openPnlLbl.textContent = formatSignedCurrency(openPnl);
  if (pnlLbl) pnlLbl.textContent = formatSignedCurrency(totalPnl);
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
  const categoryAssets = assets.filter((asset) => (asset.category || "equities") === activeTab);

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
    row.querySelector(".asset-pnl").textContent = pnlData.toFixed(2);
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
  updateAverageLine(asset);
}

function updateChartForAsset(asset) {
  if (!candleSeriesApi || selectedAssetId !== asset.id) return;
  if (asset.completedCandle) candleSeriesApi.update(asset.completedCandle);
  if (asset.candle) candleSeriesApi.update(asset.candle);
}

function buildSubmissionPayload({ useSample = false } = {}) {
  const pnl = Number((useSample ? 789.12 : totalPnlValue).toFixed(2));
  const score = Number((useSample ? 1234.56 : pnl).toFixed(2));
  const winRate = Number((useSample ? 0.67 : totalTrades ? winTrades / totalTrades : 0).toFixed(4));
  const drawdownValue = Number((useSample ? 250.34 : maxDrawdown).toFixed(2));
  const finalValue = Number((availableCash + totalPnlValue).toFixed(2));

  return {
    runId,
    score,
    pnl,
    sharpe: null,
    max_drawdown: drawdownValue,
    win_rate: winRate,
    extra: {
      eventCode,
      scenarioId,
      cash: availableCash,
      total_pnl: pnl,
      final_value: finalValue,
      num_trades: totalTrades,
      winning_trades: winTrades,
      submittedAt: new Date().toISOString(),
      mode: useSample ? "debug" : "live",
    },
  };
}

function clearResultActions() {
  if (resultActions) resultActions.innerHTML = "";
}

function addResultButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary";
  button.textContent = label;
  button.addEventListener("click", onClick);
  resultActions?.appendChild(button);
}

function addResultLink(label, href, { disabled = false } = {}) {
  const link = document.createElement("a");
  link.className = "button-link";
  link.textContent = label;

  if (disabled || !href) {
    link.href = "#";
    link.setAttribute("aria-disabled", "true");
    link.classList.add("disabled");
    link.addEventListener("click", (event) => event.preventDefault());
  } else {
    link.href = href;
    link.target = "_blank";
    link.rel = "noreferrer";
  }

  resultActions?.appendChild(link);
}

function setResultMessage(message) {
  if (resultMessage) resultMessage.textContent = message;
}

async function submitResults(payload) {
  if (hasSubmittedRun) return;

  if (!backendUrl) {
    setResultMessage("Could not submit results: backend URL not configured.");
    clearResultActions();
    addResultButton("Retry", () => latestSubmissionPayload && submitResults(latestSubmissionPayload));
    return;
  }

  latestSubmissionPayload = payload;
  setResultMessage("Submitting results…");
  clearResultActions();

  try {
    const response = await fetch(`${backendUrl}/api/runs/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.status === 409) {
      hasSubmittedRun = true;
      setResultMessage("Already submitted.");
    } else if (!response.ok) {
      throw new Error(`submit-failed-${response.status}`);
    } else {
      hasSubmittedRun = true;
      setResultMessage("Results submitted ✅");
    }

    if (submitTestBtn) submitTestBtn.disabled = true;
    clearResultActions();
    addResultLink("View results on Mint", mintUrl ? `${mintUrl}/multiplayer/runs/${runId}` : "", { disabled: !mintUrl });
  } catch {
    setResultMessage("Could not submit results. Retry.");
    clearResultActions();
    addResultButton("Retry", () => latestSubmissionPayload && submitResults(latestSubmissionPayload));
  }
}

function submitLiveResults() {
  if (!runId || hasSubmittedRun) return;
  submitResults(buildSubmissionPayload({ useSample: false }));
}

function setPhase(phase) {
  currentPhase = String(phase || "running").toLowerCase();
  if (phaseBadge) phaseBadge.textContent = `Phase: ${currentPhase}`;

  const marketOpen = currentPhase === "running";
  if (buyBtn) buyBtn.disabled = !marketOpen;
  if (sellBtn) sellBtn.disabled = !marketOpen;

  if (currentPhase === "ended" || currentPhase === "finished" || currentPhase === "complete") {
    submitLiveResults();
  }
}

async function pollEventStatus() {
  if (!backendUrl || !eventCode || hasSubmittedRun) return;
  try {
    const response = await fetch(`${backendUrl}/api/events/${encodeURIComponent(eventCode)}`);
    if (!response.ok) return;
    const payload = await response.json();
    if (["ended", "finished", "complete"].includes(String(payload?.status || payload?.phase || "").toLowerCase())) {
      setPhase("ended");
    }
  } catch {
    // optional polling endpoint
  }
}

function handleOrder(side) {
  if (!selectedAssetId) {
    setTradeStatus("Select an asset first.", "error");
    return;
  }
  if (currentPhase !== "running") {
    setTradeStatus("Market is paused/ended.", "error");
    return;
  }

  const qty = Number(quantityInput.value || 0);
  socket.emit("submitOrder", { assetId: selectedAssetId, side, qty, type: "market" }, (res) => {
    if (!res?.ok) {
      setTradeStatus("Order rejected.", "error");
      return;
    }
    setTradeStatus("Order filled.", "success");
  });
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
  assets = payload.assets || [];
  assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  renderAssetTabs();
  renderAssetsList();
  if (!selectedAssetId && assets.length) {
    const preferred = assets.find((asset) => asset.category === activeTab) || assets[0];
    selectAsset(preferred.id);
  }
});

socket.on("assetTick", (payload) => {
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
  updateAssetsListValues();
});

socket.on("execution", (payload) => {
  const tradePnl = Number(payload?.realizedPnlDelta ?? 0);
  totalTrades += 1;
  if (tradePnl > 0) winTrades += 1;
});

socket.on("openOrders", (payload) => {
  openOrders = payload?.orders || [];
  if (!openOrdersList) return;
  openOrdersList.innerHTML = "";
  const scoped = openOrders.filter((order) => order.assetId === selectedAssetId);
  if (!scoped.length) {
    const item = document.createElement("li");
    item.className = "empty-order";
    item.textContent = "No open orders";
    openOrdersList.appendChild(item);
    return;
  }
  scoped.forEach((order) => {
    const li = document.createElement("li");
    li.textContent = `${order.side.toUpperCase()} ${order.qty} @ ${order.price}`;
    openOrdersList.appendChild(li);
  });
});

socket.on("news", (payload) => {
  pushNewsItem(payload?.headline, payload?.tick);
});

socket.on("scenarioError", (payload) => {
  showLaunchError("Scenario not found. Launch from Mint.", payload?.message || "Scenario not found. Launch from Mint.");
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
    hide(joinView);
    hide(waitView);
    show(gameView);
    setPhase(res.phase);
  });
});

if (mintHomeLink) {
  if (mintUrl) mintHomeLink.href = mintUrl;
  else {
    mintHomeLink.href = "#";
    mintHomeLink.setAttribute("aria-disabled", "true");
    mintHomeLink.classList.add("disabled");
    mintHomeLink.addEventListener("click", (event) => event.preventDefault());
  }
}

if (runIdLabel) runIdLabel.textContent = runId ? `Run: ${runId}` : "Run: missing";

async function init() {
  const scenario = await validateScenario();
  if (!scenario) {
    showLaunchError("Scenario not found. Launch from Mint.", "Scenario not found. Launch from Mint.");
    return;
  }

  if (scenarioLabel) {
    scenarioLabel.textContent = `${scenario.name || scenarioId} (${scenario.id || scenarioId})`;
  }

  if (!runId) {
    showLaunchError("Missing run_id. Please launch from Mint.", "This simulation must be opened from a Mint run link.");
    return;
  }

  setResultMessage("Results will be submitted when the round ends.");

  if (submitTestBtn && isDebugSubmissionEnabled) {
    show(submitTestBtn);
    submitTestBtn.addEventListener("click", () => submitResults(buildSubmissionPayload({ useSample: true })));
  }

  socket.connect();
  setInterval(pollEventStatus, 4000);
  updatePortfolioSummary();
}

init();
