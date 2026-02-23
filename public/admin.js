const query = new URLSearchParams(window.location.search);
const requestedScenarioId = query.get("scenario_id") || "";

const TAB_ORDER = ["equities", "commodities", "bonds"];
const TAB_LABELS = { equities: "Equities", commodities: "Commodities", bonds: "Bonds" };

const phaseBadge = document.getElementById("adminPhaseBadge");
const tickBadge = document.getElementById("adminTickBadge");
const playersTbody = document.getElementById("playersTbody");
const adminPortfolioPie = document.getElementById("adminPortfolioPie");
const adminPortfolioPieDetails = document.getElementById("adminPortfolioPieDetails");
const adminPortfolioPieTotals = document.getElementById("adminPortfolioPieTotals");
const controlStatus = document.getElementById("controlStatus");
const assetTabs = document.getElementById("adminAssetTabs");
const assetsList = document.getElementById("adminAssetsList");
const selectedAssetLabel = document.getElementById("selectedAssetLabel");
const adminScenarioLabel = document.getElementById("adminScenarioLabel");
const scenarioSelect = document.getElementById("scenarioSelect");
const adminNewsFeed = document.getElementById("adminNewsFeed");
const adminChartEl = document.getElementById("adminChart");

let activeTab = "equities";
let selectedAssetId = null;
let assets = [];
let assetMap = new Map();
let assetRowMap = new Map();
let chartApi = null;
let candleSeries = null;
let fairSeries = null;
let fairValuePriceLine = null;
let chartResizeObserver = null;
let selectedScenarioId = "";
let currentTick = 0;
let durationTicks = 21600;
let newsTimeline = [];
let selectedScenarioNews = [];
let adminPlayers = [];
let averagePlayer = null;
let selectedPortfolioOwnerId = "average";
let pieRenderState = { cx: 0, cy: 0, radius: 0, slices: [], total: 0, ownerName: "" };
let hoveredPieSliceKey = null;
let playersFetchInFlight = false;
let lastPlayersFetchAt = 0;

const socket = io({ transports: ["websocket", "polling"], query: { role: "admin" } });

function fmt(value, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return Number(value).toFixed(digits);
}

function setControlStatus(text, tone = "") {
  if (!controlStatus) return;
  controlStatus.textContent = text;
  controlStatus.dataset.tone = tone;
}

function setPhase(phase) {
  if (phaseBadge) phaseBadge.textContent = `Phase: ${phase}`;
}

function updateTickBadge() {
  if (!tickBadge) return;
  tickBadge.textContent = `Tick: ${currentTick} / ${durationTicks}`;
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatSignedCurrency(value) {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(Number(value)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "—";
  return `${Number(value).toFixed(2)}%`;
}

function paletteFromCategory(category = "equities", idx = 0, total = 1) {
  const ratio = total > 1 ? idx / (total - 1) : 0.5;
  if (category === "commodities") {
    return `hsl(${48 - ratio * 10}, 95%, ${62 - ratio * 18}%)`;
  }
  return `hsl(${200 + ratio * 14}, 95%, ${62 - ratio * 18}%)`;
}

function paintAdminPortfolioPie(owner) {
  if (!adminPortfolioPie) return;
  const ctx = adminPortfolioPie.getContext("2d");
  if (!ctx) return;

  const slices = Array.isArray(owner?.slices)
    ? owner.slices
      .filter((slice) => Number(slice?.value || 0) > 0)
      .map((slice) => ({ ...slice }))
    : [];
  const total = slices.reduce((sum, slice) => sum + Number(slice.value || 0), 0);

  const categoryBuckets = { commodities: [], equities: [] };
  slices.forEach((slice) => {
    if (slice.category === "commodities") categoryBuckets.commodities.push(slice);
    else categoryBuckets.equities.push(slice);
  });

  ["commodities", "equities"].forEach((category) => {
    categoryBuckets[category].forEach((slice, idx) => {
      slice.color = paletteFromCategory(category, idx, categoryBuckets[category].length);
    });
  });

  const w = adminPortfolioPie.width;
  const h = adminPortfolioPie.height;
  const cx = w / 2;
  const cy = h / 2 - 4;
  const radius = Math.min(w, h) * 0.35;
  ctx.clearRect(0, 0, w, h);

  let start = -Math.PI / 2;
  slices.forEach((slice) => {
    const angle = total > 0 ? (Number(slice.value || 0) / total) * Math.PI * 2 : 0;
    const sliceStart = start;
    const end = sliceStart + angle;
    slice.key = slice.assetId || slice.symbol || slice.label || `${slice.category}-${sliceStart}`;
    slice.startAngle = sliceStart;
    slice.endAngle = end;
    slice.percent = total > 0 ? (Number(slice.value || 0) / total) * 100 : 0;
    const isHovered = hoveredPieSliceKey && hoveredPieSliceKey === slice.key;
    const drawRadius = isHovered ? radius + 6 : radius;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, drawRadius, sliceStart, end);
    ctx.closePath();
    ctx.fillStyle = slice.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#0d1423";
    ctx.stroke();
    start = end;
  });

  pieRenderState = {
    cx,
    cy,
    radius: radius + 8,
    slices,
    total,
    ownerName: owner?.name || "—",
  };

  if (hoveredPieSliceKey && !slices.some((slice) => slice.key === hoveredPieSliceKey)) {
    hoveredPieSliceKey = null;
  }

  if (!slices.length) {
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "13px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("No positions yet", cx, cy + 4);
  }

  const commoditiesValue = slices
    .filter((slice) => slice.category === "commodities")
    .reduce((sum, slice) => sum + Number(slice.value || 0), 0);
  const equitiesValue = slices
    .filter((slice) => slice.category === "equities")
    .reduce((sum, slice) => sum + Number(slice.value || 0), 0);

  if (adminPortfolioPieDetails) {
    const countLabel = owner?.id === "average" ? ` across ${owner?.playerCount || 0} players` : "";
    const hoveredSlice = slices.find((slice) => slice.key === hoveredPieSliceKey);
    const hoverLabel = hoveredSlice
      ? ` · Hover: ${hoveredSlice.symbol || hoveredSlice.label || "Asset"} ${hoveredSlice.percent.toFixed(2)}% (${formatSignedCurrency(hoveredSlice.value || 0)})`
      : "";
    adminPortfolioPieDetails.textContent = `${owner?.name || "—"}${countLabel} · Invested ${formatPercent(owner?.investedPct || 0)} · PnL ${formatSignedCurrency(owner?.pnl || 0)}${hoverLabel}`;
  }
  if (adminPortfolioPieTotals) {
    const commodityPct = total > 0 ? (commoditiesValue / total) * 100 : 0;
    const equitiesPct = total > 0 ? (equitiesValue / total) * 100 : 0;
    adminPortfolioPieTotals.textContent = `Commodities: ${commodityPct.toFixed(2)}% · Equities: ${equitiesPct.toFixed(2)}%`;
  }
}

function pieSliceAtPosition(clientX, clientY) {
  if (!adminPortfolioPie) return null;
  const rect = adminPortfolioPie.getBoundingClientRect();
  const scaleX = rect.width ? adminPortfolioPie.width / rect.width : 1;
  const scaleY = rect.height ? adminPortfolioPie.height / rect.height : 1;
  const x = (clientX - rect.left) * scaleX;
  const y = (clientY - rect.top) * scaleY;
  const dx = x - pieRenderState.cx;
  const dy = y - pieRenderState.cy;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance > pieRenderState.radius) return null;

  let angle = Math.atan2(dy, dx);
  if (angle < -Math.PI / 2) angle += Math.PI * 2;
  return pieRenderState.slices.find((slice) => angle >= slice.startAngle && angle <= slice.endAngle) || null;
}

function bindPieHover() {
  if (!adminPortfolioPie) return;
  adminPortfolioPie.addEventListener("mousemove", (event) => {
    const hovered = pieSliceAtPosition(event.clientX, event.clientY);
    const nextHoverKey = hovered?.key || null;
    if (nextHoverKey === hoveredPieSliceKey) return;
    hoveredPieSliceKey = nextHoverKey;
    const owner = selectedPortfolioOwnerId === "average" ? averagePlayer : adminPlayers.find((player) => player.id === selectedPortfolioOwnerId);
    paintAdminPortfolioPie(owner || averagePlayer || null);
  });

  adminPortfolioPie.addEventListener("mouseleave", () => {
    if (!hoveredPieSliceKey) return;
    hoveredPieSliceKey = null;
    const owner = selectedPortfolioOwnerId === "average" ? averagePlayer : adminPlayers.find((player) => player.id === selectedPortfolioOwnerId);
    paintAdminPortfolioPie(owner || averagePlayer || null);
  });
}

function selectPortfolioOwner(id) {
  selectedPortfolioOwnerId = id;
  const owner = id === "average" ? averagePlayer : adminPlayers.find((player) => player.id === id);
  paintAdminPortfolioPie(owner || averagePlayer || null);
  renderPlayers();
}

function renderPlayers() {
  if (!playersTbody) return;
  playersTbody.innerHTML = "";

  const rows = [];
  if (averagePlayer) rows.push(averagePlayer);
  rows.push(...adminPlayers);

  rows.forEach((player) => {
    const tr = document.createElement("tr");
    tr.classList.toggle("active", player.id === selectedPortfolioOwnerId);
    tr.classList.toggle("average-row", player.id === "average");
    tr.innerHTML = `<td><button class="admin-player-btn" type="button">${player.name || "—"}</button></td><td>${formatPercent(player.investedPct || 0)}</td><td class="${Number(player.pnl || 0) > 0 ? "positive" : Number(player.pnl || 0) < 0 ? "negative" : ""}">${formatSignedCurrency(player.pnl || 0)}</td>`;
    tr.querySelector(".admin-player-btn")?.addEventListener("click", () => selectPortfolioOwner(player.id));
    playersTbody.appendChild(tr);
  });
}

function impactPctForNewsItem(item) {
  const shocks = item?.assetShocks || {};
  const values = Object.values(shocks).map((value) => Math.abs(Number(value) * 100)).filter(Number.isFinite);
  return values.length ? Math.max(...values) : 0;
}

function impactClass(impactPct) {
  if (impactPct < 1) return "impact-low";
  if (impactPct < 4) return "impact-light";
  if (impactPct < 8) return "impact-medium";
  return "impact-high";
}

function gameTimeForTick(tick) {
  return asNumber(tick) * 12 * 60 * 1000;
}

function formatGameTimeFromTick(tick) {
  const gameMs = gameTimeForTick(tick);
  return new Date(gameMs).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildScenarioNewsTimeline() {
  const majorNewsTicks = new Set(
    (currentScenarioPayload?.news || [])
      .filter((item) => Boolean(item?.major))
      .map((item) => asNumber(item.tick, -1))
      .filter((tick) => tick >= 0),
  );

  const macroEntries = selectedScenarioNews.map((event) => {
    const impactPct = 0;
    const actualTick = asNumber(event.actualTick);
    const isMajor = majorNewsTicks.has(actualTick) || /major event/i.test(String(event.label || ""));
    return {
      id: `${event.id || event.label}-outcome`,
      tick: actualTick,
      token: "Outcome",
      label: event.label || "Macro release",
      value: event.actual || "—",
      impactPct,
      isMajor,
      releaseTick: actualTick,
    };
  });

  const generalEntries = (currentScenarioPayload?.news || []).map((item, index) => ({
    id: `news-${index}-${asNumber(item.tick)}`,
    tick: asNumber(item.tick),
    token: "News",
    label: item.headline || "News",
    value: item.headline || "—",
    impactPct: impactPctForNewsItem(item),
    isMajor: Boolean(item?.major) || /major event/i.test(String(item?.headline || "")),
    releaseTick: asNumber(item.tick),
  }));

  newsTimeline = [...macroEntries, ...generalEntries].sort((a, b) => a.tick - b.tick);
}

function renderAdminNewsTimeline() {
  if (!adminNewsFeed) return;
  adminNewsFeed.innerHTML = "";

  if (!newsTimeline.length) {
    const empty = document.createElement("div");
    empty.className = "macro-item";
    empty.innerHTML = `<strong>No news loaded</strong><span class="muted">Load a scenario to view the full release timeline.</span>`;
    adminNewsFeed.appendChild(empty);
    return;
  }

  newsTimeline.forEach((entry) => {
    const item = document.createElement("div");
    const released = currentTick >= entry.releaseTick;
    item.className = `macro-item admin-news-item ${impactClass(entry.impactPct)}`;
    if (released) item.classList.add("released");
    if (entry.isMajor) item.classList.add("major-admin-news-item");

    item.innerHTML = `<strong>${entry.label}</strong><span class="macro-status ${entry.token.toLowerCase()}">${entry.token} · Tick ${entry.tick} (${formatGameTimeFromTick(entry.tick)})</span><span>${entry.value}</span>`;
    adminNewsFeed.appendChild(item);
  });
}

let currentScenarioPayload = null;

async function loadScenarioNewsTimeline(scenarioId) {
  if (!scenarioId) return;
  try {
    const response = await fetch(`/scenarios/${encodeURIComponent(scenarioId)}.json`, { cache: "no-store" });
    if (!response.ok) throw new Error("scenario-news-missing");
    currentScenarioPayload = await response.json();
    selectedScenarioNews = Array.isArray(currentScenarioPayload?.macroEvents) ? currentScenarioPayload.macroEvents : [];
  } catch {
    currentScenarioPayload = null;
    selectedScenarioNews = [];
  }
  buildScenarioNewsTimeline();
  renderAdminNewsTimeline();
}

function ensureChart() {
  if (chartApi || !adminChartEl) return;
  chartApi = LightweightCharts.createChart(adminChartEl, {
    width: Math.max(0, adminChartEl.clientWidth),
    height: Math.max(0, adminChartEl.clientHeight),
    layout: { background: { color: "#0d1423" }, textColor: "#e7efff" },
    grid: { vertLines: { color: "#1b2b45" }, horzLines: { color: "#1b2b45" } },
    rightPriceScale: {
      borderColor: "#1b2b45",
      autoScale: true,
      scaleMargins: { top: 0.12, bottom: 0.12 },
    },
    timeScale: { borderColor: "#1b2b45", timeVisible: true },
  });

  candleSeries = chartApi.addCandlestickSeries({
    upColor: "#2ecc71",
    downColor: "#ff5c5c",
    borderUpColor: "#2ecc71",
    borderDownColor: "#ff5c5c",
    wickUpColor: "#2ecc71",
    wickDownColor: "#ff5c5c",
  });
  fairSeries = chartApi.addLineSeries({
    color: "#ffd84d",
    lineWidth: 2,
    title: "Fair Value",
    lastValueVisible: true,
    priceLineVisible: false,
  });

  chartResizeObserver = new ResizeObserver(() => {
    chartApi?.applyOptions({ width: adminChartEl.clientWidth, height: adminChartEl.clientHeight });
  });
  chartResizeObserver.observe(adminChartEl);
}

function renderTabs() {
  assetTabs.innerHTML = "";
  TAB_ORDER.forEach((tab) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "asset-tab";
    btn.textContent = TAB_LABELS[tab];
    btn.classList.toggle("active", tab === activeTab);
    btn.addEventListener("click", () => {
      activeTab = tab;
      renderTabs();
      renderAssets();
    });
    assetTabs.appendChild(btn);
  });
}

function updateAssetRowDisplay(asset) {
  const row = assetRowMap.get(asset.id);
  if (!row) return;
  row.querySelector(".asset-price").textContent = fmt(asset.price, asset.isYield ? 3 : 2);
  row.querySelector(".asset-pnl").textContent = fmt(asset.fairValue, asset.isYield ? 3 : 2);
  row.classList.toggle("active", asset.id === selectedAssetId);
}

function renderAssets() {
  assetsList.innerHTML = "";
  assetRowMap = new Map();
  const inTab = assets.filter((asset) => (asset.category || "equities") === activeTab);

  const appendAsset = (asset) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "asset-row admin-asset-row";
    row.dataset.asset = asset.id;
    row.innerHTML = `<span class="asset-symbol">${asset.symbol}</span><span class="asset-price">${fmt(asset.price, asset.isYield ? 3 : 2)}</span><span class="asset-position">FV</span><span class="asset-pnl">${fmt(asset.fairValue, asset.isYield ? 3 : 2)}</span>`;
    row.addEventListener("click", () => selectAsset(asset.id));
    assetRowMap.set(asset.id, row);
    row.classList.toggle("active", asset.id === selectedAssetId);
    assetsList.appendChild(row);
  };

  if (activeTab === "equities") {
    const groups = [
      { title: "Stocks", items: inTab.filter((a) => a.group !== "indices") },
      { title: "Indices", items: inTab.filter((a) => a.group === "indices") },
    ];
    groups.forEach((group) => {
      if (!group.items.length) return;
      const heading = document.createElement("div");
      heading.className = "asset-subsection";
      heading.textContent = group.title;
      assetsList.appendChild(heading);
      group.items.forEach((asset) => appendAsset(asset));
    });
    return;
  }

  inTab.forEach((asset) => appendAsset(asset));
}

function upsertFairPoint(asset, pointOrTime, maybeValue) {
  if (!Array.isArray(asset.fairPoints)) asset.fairPoints = [];
  const fairValue = Number.isFinite(maybeValue)
    ? maybeValue
    : Number.isFinite(asset.fairValue)
      ? asset.fairValue
      : asset.price;
  const point = typeof pointOrTime === "object" && pointOrTime
    ? {
      time: pointOrTime.time,
      value: Number.isFinite(pointOrTime.value) ? pointOrTime.value : fairValue,
    }
    : { time: pointOrTime, value: fairValue };

  if (!Number.isFinite(point?.time) || !Number.isFinite(point?.value)) return;

  const last = asset.fairPoints[asset.fairPoints.length - 1];
  if (last && last.time === point.time) {
    asset.fairPoints[asset.fairPoints.length - 1] = point;
  } else {
    asset.fairPoints.push(point);
  }
}

function setChartDataForAsset(asset) {
  if (!candleSeries || !fairSeries) return;
  const fairValue = Number.isFinite(asset.fairValue) ? asset.fairValue : asset.price;
  const candles = [...(asset.candles || [])];
  if (asset.candle) candles.push(asset.candle);
  candleSeries.setData(candles);

  if (!Array.isArray(asset.fairPoints)) asset.fairPoints = [];
  if (!asset.fairPoints.length && candles.length) {
    asset.fairPoints = candles.map((c) => ({ time: c.time, value: c.close }));
  }
  if (asset.fairPoint) upsertFairPoint(asset, asset.fairPoint);
  fairSeries.setData(asset.fairPoints);

  if (fairValuePriceLine) {
    fairSeries.removePriceLine(fairValuePriceLine);
    fairValuePriceLine = null;
  }
  if (Number.isFinite(fairValue)) {
    fairValuePriceLine = fairSeries.createPriceLine({
      price: fairValue,
      color: "#ffd84d",
      lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      title: "FV",
    });
  }

  chartApi?.timeScale().fitContent();
}

function selectAsset(assetId) {
  const asset = assetMap.get(assetId);
  if (!asset) return;
  selectedAssetId = assetId;
  selectedAssetLabel.textContent = `${asset.symbol} — ${asset.name}`;
  activeTab = asset.category || activeTab;
  renderTabs();
  renderAssets();
  ensureChart();
  setChartDataForAsset(asset);
}

function updateChartAsset(asset) {
  if (!candleSeries || !fairSeries || selectedAssetId !== asset.id) return;
  const fairValue = Number.isFinite(asset.fairValue) ? asset.fairValue : asset.price;
  if (asset.completedCandle) {
    candleSeries.update(asset.completedCandle);
    upsertFairPoint(asset, asset.completedFairPoint || { time: asset.completedCandle.time, value: fairValue });
    fairSeries.update(asset.completedFairPoint || { time: asset.completedCandle.time, value: fairValue });
  }
  if (asset.candle) {
    candleSeries.update(asset.candle);
    upsertFairPoint(asset, asset.fairPoint || { time: asset.candle.time, value: fairValue });
    fairSeries.update(asset.fairPoint || { time: asset.candle.time, value: fairValue });
  }

  if (fairValuePriceLine) {
    fairSeries.removePriceLine(fairValuePriceLine);
    fairValuePriceLine = null;
  }
  if (Number.isFinite(fairValue)) {
    fairValuePriceLine = fairSeries.createPriceLine({
      price: fairValue,
      color: "#ffd84d",
      lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      title: "FV",
    });
  }
}

async function loadScenarios() {
  try {
    const response = await fetch("/api/scenarios", { cache: "no-store" });
    if (!response.ok) throw new Error("no-scenarios");
    const payload = await response.json();
    const scenarios = payload?.scenarios || [];

    if (!scenarioSelect) return;
    scenarioSelect.innerHTML = "";

    scenarios.forEach((scenario) => {
      const option = document.createElement("option");
      option.value = scenario.id || scenario.scenario_id;
      option.textContent = `${scenario.name || scenario.id} (${scenario.id || scenario.scenario_id})`;
      scenarioSelect.appendChild(option);
    });

    selectedScenarioId = requestedScenarioId || scenarios[0]?.id || scenarios[0]?.scenario_id || "";
    if (selectedScenarioId) scenarioSelect.value = selectedScenarioId;
    if (adminScenarioLabel) adminScenarioLabel.textContent = `Scenario: ${selectedScenarioId || "none selected"}`;
    await loadScenarioNewsTimeline(selectedScenarioId);
  } catch {
    setControlStatus("Unable to load scenarios.", "error");
  }
}

async function startScenario() {
  setControlStatus("Starting scenario…");
  try {
    const response = await fetch("/api/admin/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario_id: selectedScenarioId || undefined }),
    });

    if (!response.ok) throw new Error(`start-failed-${response.status}`);
    setControlStatus("Scenario started.", "success");
    if (adminScenarioLabel) adminScenarioLabel.textContent = `Scenario: ${selectedScenarioId}`;
  } catch {
    setControlStatus("Could not start scenario.", "error");
  }
}

async function selectScenario() {
  selectedScenarioId = scenarioSelect?.value || selectedScenarioId;
  if (!selectedScenarioId) {
    setControlStatus("Choose a scenario first.", "error");
    return;
  }

  setControlStatus("Loading scenario…");
  try {
    const response = await fetch("/api/admin/scenario", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario_id: selectedScenarioId }),
    });
    if (!response.ok) throw new Error(`scenario-failed-${response.status}`);
    if (adminScenarioLabel) adminScenarioLabel.textContent = `Scenario: ${selectedScenarioId}`;
    await loadScenarioNewsTimeline(selectedScenarioId);
    setControlStatus("Scenario loaded. Start when ready.", "success");
  } catch {
    setControlStatus("Could not load scenario.", "error");
  }
}

async function runControl(phase, label) {
  setControlStatus(`${label} requested...`);
  try {
    const response = await fetch("/api/admin/phase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phase }),
    });

    if (!response.ok) throw new Error(`failed-${response.status}`);

    setControlStatus(`${label} confirmed`, "success");
    setPhase(phase);
    socket.emit("adminPhaseSync", { phase });
  } catch {
    setControlStatus(`${label} failed`, "error");
  }
}

async function fetchPlayers(force = false) {
  const now = Date.now();
  if (!force && (playersFetchInFlight || now - lastPlayersFetchAt < 1200)) return;
  playersFetchInFlight = true;
  lastPlayersFetchAt = now;
  try {
    const response = await fetch("/api/admin/players", { cache: "no-store" });
    if (!response.ok) throw new Error("admin-players-unavailable");
    const payload = await response.json();
    adminPlayers = Array.isArray(payload?.players) ? payload.players : [];
    averagePlayer = payload?.average || null;
    if (!selectedPortfolioOwnerId && averagePlayer) selectedPortfolioOwnerId = averagePlayer.id;
    if (selectedPortfolioOwnerId !== "average" && !adminPlayers.some((player) => player.id === selectedPortfolioOwnerId)) {
      selectedPortfolioOwnerId = averagePlayer ? "average" : adminPlayers[0]?.id || "";
    }
    renderPlayers();
    selectPortfolioOwner(selectedPortfolioOwnerId || (averagePlayer ? "average" : adminPlayers[0]?.id || ""));
  } catch {
    adminPlayers = [];
    averagePlayer = null;
    renderPlayers();
    paintAdminPortfolioPie(null);
  } finally {
    playersFetchInFlight = false;
  }
}

document.getElementById("startBtn")?.addEventListener("click", () => startScenario());
document.getElementById("pauseBtn")?.addEventListener("click", () => runControl("paused", "Pause"));
document.getElementById("endBtn")?.addEventListener("click", () => runControl("ended", "End"));
scenarioSelect?.addEventListener("change", () => selectScenario());

socket.on("phase", setPhase);
socket.on("adminAssetSnapshot", (payload) => {
  currentTick = Number(payload?.tick || currentTick);
  durationTicks = Number(payload?.durationTicks || durationTicks);
  updateTickBadge();
  renderAdminNewsTimeline();
  if (payload?.scenario && adminScenarioLabel) {
    adminScenarioLabel.textContent = `Scenario: ${payload.scenario.name || payload.scenario.id} (${payload.scenario.id || ""})`;
    if (scenarioSelect && payload.scenario.id) scenarioSelect.value = payload.scenario.id;
  }

  assets = (payload.assets || []).map((asset) => ({
    ...asset,
    fairPoints: [...(asset.fairPoints || [])],
    fairPoint: asset.fairPoint || null,
    completedFairPoint: null,
  }));
  assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  renderTabs();
  renderAssets();
  if (!selectedAssetId && assets.length) selectAsset(assets[0].id);
  if (selectedAssetId) {
    const selected = assetMap.get(selectedAssetId);
    if (selected) setChartDataForAsset(selected);
  }
  fetchPlayers(true);
});

socket.on("adminAssetTick", (payload) => {
  currentTick = Number(payload?.tick || currentTick);
  durationTicks = Number(payload?.durationTicks || durationTicks);
  updateTickBadge();
  renderAdminNewsTimeline();

  (payload.assets || []).forEach((update) => {
    const asset = assetMap.get(update.id);
    if (!asset) return;
    asset.price = update.price;
    asset.fairValue = update.fairValue;
    asset.candle = update.candle;
    asset.completedCandle = update.completedCandle;
    asset.fairPoint = update.fairPoint || null;
    asset.completedFairPoint = update.completedFairPoint || null;
    if (update.completedCandle) {
      asset.candles.push(update.completedCandle);
      upsertFairPoint(asset, update.completedFairPoint || { time: update.completedCandle.time, value: asset.fairValue });
    }
    if (update.candle) upsertFairPoint(asset, update.fairPoint || { time: update.candle.time, value: asset.fairValue });
    updateAssetRowDisplay(asset);
    updateChartAsset(asset);
  });
  fetchPlayers();
});

socket.on("scenarioError", (payload) => {
  setControlStatus(payload?.message || "Scenario not found.", "error");
});

socket.on("macroEvents", (payload) => {
  currentTick = Number(payload?.tick || currentTick);
  updateTickBadge();
  renderAdminNewsTimeline();
});

socket.on("news", () => {
  renderAdminNewsTimeline();
});

updateTickBadge();
renderAdminNewsTimeline();
loadScenarios();
bindPieHover();
fetchPlayers(true);
