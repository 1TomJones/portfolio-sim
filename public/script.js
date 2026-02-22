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
const realizedPnlLbl = document.getElementById("realizedPnlLbl");
const assetsList = document.getElementById("assetsList");
const assetTabs = document.getElementById("assetTabs");
const assetSubheading = document.getElementById("assetSubheading");
const orderAssetLabel = document.getElementById("orderAssetLabel");
const buyBtn = document.getElementById("buyBtn");
const sellBtn = document.getElementById("sellBtn");
const quantityInput = document.getElementById("quantityInput");
const orderValueLabel = document.getElementById("orderValueLabel");
const portfolioPie = document.getElementById("portfolioPie");
const portfolioPieDetails = document.getElementById("portfolioPieDetails");
const portfolioPieTotals = document.getElementById("portfolioPieTotals");
const fullscreenButtons = Array.from(document.querySelectorAll("[data-fullscreen]"));


const chartContainer = document.getElementById("chart");
let chartApi = null;
let candleSeriesApi = null;
let avgPriceLineCandle = null;
let chartResizeObserver = null;
let pendingChartAutofit = false;
let piePointerInside = false;
let pieHoveredAssetId = null;
let lastPortfolioRenderSignature = "";
let lastPortfolioHoverSignature = "";

function refitChartViewport() {
  if (!chartApi || !candleSeriesApi) return;
  chartApi.timeScale().fitContent();
  chartApi.timeScale().scrollToRealTime();
  chartApi.priceScale("right").applyOptions({ autoScale: true });
}

function scheduleChartAutofitOnNextTick() {
  pendingChartAutofit = true;
}

function runPendingChartAutofit() {
  if (!pendingChartAutofit) return;
  refitChartViewport();
  pendingChartAutofit = false;
}

let assets = [];
let assetMap = new Map();
let selectedAssetId = null;
let activeTab = "equities";
let positions = new Map();
let availableCash = 10000000;
let totalPnlValue = 0;
let highestEquity = availableCash;
let maxDrawdown = 0;
let currentPhase = "lobby";
let hasJoined = false;
let macroEvents = [];
let knownMacroReleaseIds = new Set();
let currentTick = 0;
let simStartMs = null;
let tickMs = 500;
const GAME_MS_PER_TICK = 12 * 60 * 1000;


function formatGameTime(gameTimeMs) {
  if (!Number.isFinite(gameTimeMs)) return "—";
  return new Date(gameTimeMs).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
  });
}


function gameTimeForTick(tick) {
  if (!Number.isFinite(simStartMs) || !Number.isFinite(tick)) return null;
  return simStartMs + Number(tick) * GAME_MS_PER_TICK;
}

function updateGameDateDisplay(gameTimeMs = null) {
  if (!gameDateBadge) return;
  const resolved = Number.isFinite(gameTimeMs)
    ? gameTimeMs
    : Number.isFinite(simStartMs)
      ? simStartMs + currentTick * GAME_MS_PER_TICK
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

function countryFlagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) return "";
  return countryCode
    .toUpperCase()
    .split("")
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join("");
}

function countryCodeFromLeadingFlag(label = "") {
  const chars = Array.from(String(label));
  if (chars.length < 2) return "";
  const [a, b] = chars;
  const isRegional = (char) => {
    const point = char.codePointAt(0);
    return point >= 0x1f1e6 && point <= 0x1f1ff;
  };
  if (!isRegional(a) || !isRegional(b)) return "";
  const toAscii = (char) => String.fromCharCode(char.codePointAt(0) - 127397);
  return `${toAscii(a)}${toAscii(b)}`.toUpperCase();
}

function getCountryCodeForMacroEvent(event = {}) {
  if (typeof event.countryCode === "string" && event.countryCode.length === 2) return event.countryCode.toUpperCase();

  const fromFlag = countryCodeFromLeadingFlag(event.label);
  if (fromFlag) return fromFlag;

  const eventId = String(event.id || "").toLowerCase();
  if (eventId.includes("us") || eventId.includes("fed")) return "US";
  if (eventId.includes("china")) return "CN";
  if (eventId.includes("ecb")) return "EU";
  if (eventId.includes("uk")) return "GB";
  if (eventId.includes("boj") || eventId.includes("japan")) return "JP";

  const label = String(event.label || "").toLowerCase();
  if (label.includes("us") || label.includes("federal reserve")) return "US";
  if (label.includes("china")) return "CN";
  if (label.includes("ecb") || label.includes("euro")) return "EU";
  if (label.includes("uk") || label.includes("brit")) return "GB";
  if (label.includes("boj") || label.includes("japan")) return "JP";

  return "";
}

function cleanedMacroLabel(label = "") {
  return String(label).replace(/^[\u{1F1E6}-\u{1F1FF}]{2}\s*/u, "").trim();
}

function pushNewsItem(headline, gameTimeMs, category = "general", isMajor = false) {
  if (!newsFeed || !headline || category !== "general") return;
  const item = document.createElement("div");
  item.className = "news-item";
  if (isMajor) item.classList.add("major-news-item", "major-news-flash");
  item.innerHTML = `<strong>${formatGameTime(gameTimeMs)}</strong><span class="muted">${headline}</span>`;
  newsFeed.prepend(item);
}

function renderMacroEvents({ scrollToTop = false } = {}) {
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
    placeholder.innerHTML = `<strong>Official news releases</strong><span class="muted">Waiting for the first release...</span>`;
    macroFeed.appendChild(placeholder);
    return;
  }

  sorted.forEach((event) => {
    const item = document.createElement("div");
    item.className = "macro-item";

    const isActualReleased = Number(currentTick) >= Number(event.actualTick);
    const ticksToActual = Number(event.actualTick) - Number(currentTick);
    const flashWindow = !isActualReleased && ticksToActual <= 50 && ticksToActual >= 0;
    const shouldFlashThisTick = Number(currentTick) % 5 === 0;
    if (flashWindow && shouldFlashThisTick) item.classList.add("flash-alert");

    const actualTimeLabel = formatGameTime(gameTimeForTick(event.actualTick));
    const expectedTimeLabel = formatGameTime(gameTimeForTick(event.expectationTick));
    const expectedLine = `<span class="macro-status expected">Expected (${expectedTimeLabel})</span><span>${event.expected}</span>`;
    const actualLine = `<span class="macro-status actual">Actual (${actualTimeLabel})</span><span>${isActualReleased ? event.actual : "-"}</span>`;

    const countryCode = getCountryCodeForMacroEvent(event);
    const flag = countryFlagEmoji(countryCode);
    const eventLabel = cleanedMacroLabel(event.label);
    const titleLine = flag
      ? `<strong class="macro-title"><span class="macro-flag" aria-hidden="true">${flag}</span><span>${eventLabel}</span></strong>`
      : `<strong>${eventLabel}</strong>`;

    item.innerHTML = `${titleLine}${expectedLine}${actualLine}`;
    macroFeed.appendChild(item);
  });

  if (scrollToTop) macroFeed.scrollTop = 0;
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

function normalizedOrderQuantity() {
  const qty = Number(quantityInput?.value || 0);
  if (!Number.isFinite(qty)) return 0;
  return Math.max(0, Math.floor(qty));
}

function updateOrderValueDisplay() {
  if (!orderValueLabel) return;
  const asset = selectedAssetId ? assetMap.get(selectedAssetId) : null;
  const value = normalizedOrderQuantity() * Number(asset?.price || 0);
  orderValueLabel.textContent = formatCurrency(value);
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


function oneMonthChangePct(asset) {
  if (!asset) return 0;
  const history = Array.isArray(asset.candles) ? asset.candles : [];
  const points = history.map((candle) => Number(candle?.close)).filter((value) => Number.isFinite(value));
  points.push(Number(asset.price));

  const current = points[points.length - 1];
  const lookbackPeriods = 60;
  const startIdx = Math.max(0, points.length - 1 - lookbackPeriods);
  const baseline = points[startIdx];

  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0) return 0;
  return ((current - baseline) / baseline) * 100;
}

function paletteFromCategory(category = "equities", idx = 0, total = 1) {
  const ratio = total > 1 ? idx / (total - 1) : 0.5;
  if (category === "commodities") {
    return `hsl(${48 - ratio * 10}, 95%, ${62 - ratio * 18}%)`;
  }
  return `hsl(${200 + ratio * 14}, 95%, ${62 - ratio * 18}%)`;
}

function computePortfolioSlices() {
  const slices = assets
    .map((asset) => {
      const posData = getPositionData(asset.id);
      const qty = Math.max(0, Number(posData.position || 0));
      const value = qty * Number(asset.price || 0);
      return {
        assetId: asset.id,
        symbol: asset.symbol,
        category: asset.category || "equities",
        value,
      };
    })
    .filter((slice) => slice.value > 0);

  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const byCategory = { commodities: 0, equities: 0 };
  slices.forEach((slice) => {
    if (slice.category === "commodities") byCategory.commodities += slice.value;
    else if (slice.category === "equities") byCategory.equities += slice.value;
  });

  const categoryBuckets = { commodities: [], equities: [] };
  slices.forEach((slice) => {
    if (slice.category === "commodities") categoryBuckets.commodities.push(slice);
    else categoryBuckets.equities.push(slice);
  });

  ["commodities", "equities"].forEach((category) => {
    const bucket = categoryBuckets[category];
    bucket.forEach((slice, idx) => {
      slice.color = paletteFromCategory(category, idx, bucket.length);
      slice.pct = total > 0 ? (slice.value / total) * 100 : 0;
    });
  });

  return { slices, total, byCategory };
}

function renderPortfolioOverview(hoveredAssetId = null) {
  if (!portfolioPie) return;
  const ctx = portfolioPie.getContext("2d");
  if (!ctx) return;

  const { slices, total, byCategory } = computePortfolioSlices();
  const dataSignature = JSON.stringify(
    slices.map((slice) => [slice.assetId, Number(slice.value.toFixed(2)), Number(slice.pct.toFixed(4))]),
  );
  const hoverSignature = hoveredAssetId || "none";
  const shouldRedraw = dataSignature !== lastPortfolioRenderSignature || hoverSignature !== lastPortfolioHoverSignature;

  if (!shouldRedraw) return;

  lastPortfolioRenderSignature = dataSignature;
  lastPortfolioHoverSignature = hoverSignature;

  const w = portfolioPie.width;
  const h = portfolioPie.height;
  const cx = w / 2;
  const cy = h / 2 - 4;
  const radius = Math.min(w, h) * 0.35;
  const hoverOffset = 10;

  ctx.clearRect(0, 0, w, h);

  let start = -Math.PI / 2;
  const geometry = [];
  slices.forEach((slice) => {
    const angle = total > 0 ? (slice.value / total) * Math.PI * 2 : 0;
    const end = start + angle;
    const isHovered = hoveredAssetId && hoveredAssetId === slice.assetId;
    const mid = (start + end) / 2;
    const dx = isHovered ? Math.cos(mid) * hoverOffset : 0;
    const dy = isHovered ? Math.sin(mid) * hoverOffset : 0;

    ctx.beginPath();
    ctx.moveTo(cx + dx, cy + dy);
    ctx.arc(cx + dx, cy + dy, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = slice.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#0d1423";
    ctx.stroke();

    geometry.push({ ...slice, start, end, cx: cx + dx, cy: cy + dy, radius });
    start = end;
  });

  portfolioPie.dataset.slices = JSON.stringify(geometry.map((g) => ({ assetId: g.assetId, start: g.start, end: g.end })));

  if (!slices.length) {
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "13px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("No positions yet", cx, cy + 4);
    if (portfolioPieDetails) portfolioPieDetails.textContent = "Buy assets to populate the portfolio overview.";
  } else if (hoveredAssetId) {
    const slice = slices.find((item) => item.assetId === hoveredAssetId);
    if (slice && portfolioPieDetails) {
      portfolioPieDetails.textContent = `${slice.symbol} · ${formatCurrency(slice.value)} · ${slice.pct.toFixed(2)}%`;
    }
  } else if (portfolioPieDetails) {
    portfolioPieDetails.textContent = "Hover over a slice to inspect value and weight.";
  }

  if (portfolioPieTotals) {
    const commodityPct = total > 0 ? (byCategory.commodities / total) * 100 : 0;
    const equitiesPct = total > 0 ? (byCategory.equities / total) * 100 : 0;
    portfolioPieTotals.textContent = `Commodities: ${commodityPct.toFixed(2)}% · Equities: ${equitiesPct.toFixed(2)}%`;
  }
}

function updatePortfolioSummary() {
  let unrealizedPnl = 0;
  let realizedPnl = 0;
  let positionValue = 0;

  positions.forEach((posData, assetId) => {
    const asset = assetMap.get(assetId);
    const price = asset?.price ?? 0;
    const unrealized = posData.position ? (price - posData.avgCost) * posData.position : 0;
    const realized = posData.realizedPnl || 0;
    unrealizedPnl += unrealized;
    realizedPnl += realized;
    positionValue += Math.max(0, posData.position) * price;
  });

  const totalPnl = realizedPnl + unrealizedPnl;
  totalPnlValue = totalPnl;
  highestEquity = Math.max(highestEquity, availableCash + totalPnlValue);
  maxDrawdown = Math.max(maxDrawdown, highestEquity - (availableCash + totalPnlValue));

  posLbl.textContent = formatCurrency(positionValue);
  if (cashLbl) cashLbl.textContent = formatCurrency(availableCash);
  if (openPnlLbl) {
    openPnlLbl.textContent = formatSignedCurrency(unrealizedPnl);
    openPnlLbl.classList.toggle("positive", unrealizedPnl > 0);
    openPnlLbl.classList.toggle("negative", unrealizedPnl < 0);
  }
  if (realizedPnlLbl) {
    realizedPnlLbl.textContent = formatSignedCurrency(realizedPnl);
    realizedPnlLbl.classList.toggle("positive", realizedPnl > 0);
    realizedPnlLbl.classList.toggle("negative", realizedPnl < 0);
  }
  if (pnlLbl) {
    pnlLbl.textContent = formatSignedCurrency(totalPnl);
    pnlLbl.classList.toggle("positive", totalPnl > 0);
    pnlLbl.classList.toggle("negative", totalPnl < 0);
  }

  renderPortfolioOverview(piePointerInside ? pieHoveredAssetId : null);
}

function createAssetRow(asset) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "asset-row";
  row.dataset.asset = asset.id;
  row.setAttribute("aria-expanded", asset.id === selectedAssetId ? "true" : "false");

  const main = document.createElement("div");
  main.className = "asset-row-main";

  const symbol = document.createElement("span");
  symbol.className = "asset-symbol";
  symbol.textContent = asset.symbol;

  const price = document.createElement("span");
  price.className = "asset-price";
  price.textContent = formatNumber(asset.price, asset.isYield ? 3 : 2);

  const position = document.createElement("span");
  position.className = "asset-position";
  position.textContent = "0";

  const posValue = document.createElement("span");
  posValue.className = "asset-pos-value";
  posValue.textContent = "$0.00";

  const pnl = document.createElement("span");
  pnl.className = "asset-pnl";
  pnl.textContent = "0.00";

  main.append(symbol, price, position, posValue, pnl);

  const detail = document.createElement("div");
  detail.className = "asset-row-detail";

  const name = document.createElement("span");
  name.className = "asset-name";
  name.textContent = asset.name || asset.symbol;

  const changeLabel = document.createElement("span");
  changeLabel.className = "asset-change-label";
  changeLabel.textContent = "1M % Chg";

  const change = document.createElement("span");
  change.className = "asset-change";
  change.textContent = "↔ 0.00%";

  detail.append(name, changeLabel, change);

  row.append(main, detail);
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

    const oneMonthPct = oneMonthChangePct(asset);
    const changeCell = row.querySelector(".asset-change");
    const arrow = oneMonthPct > 0 ? "↑" : oneMonthPct < 0 ? "↓" : "↔";
    changeCell.textContent = `${arrow} ${Math.abs(oneMonthPct).toFixed(2)}%`;
    changeCell.classList.toggle("positive", oneMonthPct > 0);
    changeCell.classList.toggle("negative", oneMonthPct < 0);

    row.querySelector(".asset-position").textContent = String(posData.position.toFixed(0));
    row.querySelector(".asset-pos-value").textContent = formatCurrency(Math.max(0, posData.position) * asset.price);

    const pnlCell = row.querySelector(".asset-pnl");
    pnlCell.textContent = formatSignedCurrency(pnlData);
    pnlCell.classList.toggle("positive", pnlData > 0);
    pnlCell.classList.toggle("negative", pnlData < 0);

    const hasPosition = Math.abs(posData.position || 0) > 0;
    row.classList.toggle("has-position", hasPosition);
    row.classList.toggle("active", asset.id === selectedAssetId);
    row.setAttribute("aria-expanded", asset.id === selectedAssetId ? "true" : "false");
  });

  updatePortfolioSummary();
}

function ensureChart() {
  if (chartApi || !chartContainer) return;
  chartApi = LightweightCharts.createChart(chartContainer, {
    layout: { background: { color: "#0d1423" }, textColor: "#e7efff" },
    grid: { vertLines: { color: "#1b2b45" }, horzLines: { color: "#1b2b45" } },
    timeScale: { borderColor: "#1b2b45", timeVisible: true },
    rightPriceScale: {
      borderColor: "#1b2b45",
      autoScale: true,
      scaleMargins: { top: 0.12, bottom: 0.12 },
    },
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
  updateOrderValueDisplay();

  ensureChart();
  const candleData = [...(asset.candles || [])];
  if (asset.candle) candleData.push(asset.candle);
  candleSeriesApi?.setData(candleData);
  scheduleChartAutofitOnNextTick();
  updateAverageLine(asset);
}

function updateChartForAsset(asset) {
  if (!candleSeriesApi || selectedAssetId !== asset.id) return;
  if (asset.completedCandle) candleSeriesApi.update(asset.completedCandle);
  if (asset.candle) candleSeriesApi.update(asset.candle);
  runPendingChartAutofit();
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

  const qty = normalizedOrderQuantity();
  if (qty <= 0) return;
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
    let asset = assetMap.get(update.id);
    if (!asset) {
      const listedAsset = {
        ...update,
        candles: Array.isArray(update.candles) ? update.candles : [],
      };
      assets.push(listedAsset);
      assetMap.set(listedAsset.id, listedAsset);
      renderAssetTabs();
      renderAssetsList();
      if (!selectedAssetId) selectAsset(listedAsset.id);
      asset = listedAsset;
    }
    asset.price = update.price;
    asset.candle = update.candle;
    asset.completedCandle = update.completedCandle;
    if (Array.isArray(update.candles) && update.candles.length) {
      asset.candles = update.candles;
    }
    if (update.completedCandle) {
      asset.candles.push(update.completedCandle);
    }
    updateChartForAsset(asset);
  });
  updateAssetsListValues();
  updateOrderValueDisplay();
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
  pushNewsItem(payload?.headline, payload?.gameTimeMs, payload?.category, payload?.major);
});

socket.on("macroEvents", (payload) => {
  currentTick = Number(payload?.tick || 0);
  if (Number.isFinite(payload?.gameTimeMs)) updateGameDateDisplay(Number(payload.gameTimeMs));
  else updateGameDateDisplay();

  macroEvents = Array.isArray(payload?.events) ? payload.events : [];
  const incomingIds = new Set(macroEvents.map((event) => event.id).filter(Boolean));
  const hasNewRelease = [...incomingIds].some((id) => !knownMacroReleaseIds.has(id));
  knownMacroReleaseIds = incomingIds;

  renderMacroEvents({ scrollToTop: hasNewRelease });
});

socket.on("roster", (payload) => {
  renderRoster(payload?.players || []);
});

socket.on("scenarioError", (payload) => {
  showLaunchError("Scenario not found.", payload?.message || "Scenario not found.");
});

buyBtn?.addEventListener("click", () => handleOrder("buy"));
sellBtn?.addEventListener("click", () => handleOrder("sell"));
quantityInput?.addEventListener("input", updateOrderValueDisplay);

portfolioPie?.addEventListener("mousemove", (event) => {
  piePointerInside = true;
  const { slices } = computePortfolioSlices();
  if (!slices.length) {
    pieHoveredAssetId = null;
    renderPortfolioOverview();
    return;
  }

  const rect = portfolioPie.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const cx = portfolioPie.width / 2;
  const cy = portfolioPie.height / 2 - 4;
  const dx = x - cx;
  const dy = y - cy;
  const distance = Math.hypot(dx, dy);
  const radius = Math.min(portfolioPie.width, portfolioPie.height) * 0.35;
  if (distance > radius + 14) {
    pieHoveredAssetId = null;
    renderPortfolioOverview();
    return;
  }

  let angle = Math.atan2(dy, dx);
  if (angle < -Math.PI / 2) angle += Math.PI * 2;
  const normalized = angle + Math.PI / 2;

  let cumulative = 0;
  let hovered = null;
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  slices.forEach((slice) => {
    const part = total > 0 ? (slice.value / total) * Math.PI * 2 : 0;
    if (!hovered && normalized >= cumulative && normalized <= cumulative + part) hovered = slice.assetId;
    cumulative += part;
  });
  pieHoveredAssetId = hovered;
  renderPortfolioOverview(hovered);
});

portfolioPie?.addEventListener("mouseleave", () => {
  piePointerInside = false;
  pieHoveredAssetId = null;
  renderPortfolioOverview();
});

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
  updateOrderValueDisplay();
  socket.connect();
  updatePortfolioSummary();
  updateGameDateDisplay();
  refreshViewForPhase();
}

init();
