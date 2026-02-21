const query = new URLSearchParams(window.location.search);
const requestedScenarioId = query.get("scenario_id") || "";

const TAB_ORDER = ["equities", "commodities", "bonds"];
const TAB_LABELS = { equities: "Equities", commodities: "Commodities", bonds: "Bonds" };

const phaseBadge = document.getElementById("adminPhaseBadge");
const tickBadge = document.getElementById("adminTickBadge");
const playersTbody = document.getElementById("playersTbody");
const controlStatus = document.getElementById("controlStatus");
const assetTabs = document.getElementById("adminAssetTabs");
const assetsList = document.getElementById("adminAssetsList");
const selectedAssetLabel = document.getElementById("selectedAssetLabel");
const adminScenarioLabel = document.getElementById("adminScenarioLabel");
const scenarioSelect = document.getElementById("scenarioSelect");
const adminNewsFeed = document.getElementById("adminNewsFeed");

let activeTab = "equities";
let selectedAssetId = null;
let assets = [];
let assetMap = new Map();
let chartApi = null;
let priceSeries = null;
let fairSeries = null;
let selectedScenarioId = "";
let currentTick = 0;
let durationTicks = 21600;
let newsTimeline = [];
let selectedScenarioNews = [];

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
  const macroEntries = selectedScenarioNews.flatMap((event) => {
    const impactPct = 0;
    return [
      {
        id: `${event.id || event.label}-expected`,
        tick: asNumber(event.expectationTick),
        token: "Expected",
        label: event.label || "Macro release",
        value: event.expected || "—",
        impactPct,
        releaseTick: asNumber(event.expectationTick),
      },
      {
        id: `${event.id || event.label}-actual`,
        tick: asNumber(event.actualTick),
        token: "Actual",
        label: event.label || "Macro release",
        value: event.actual || "—",
        impactPct,
        releaseTick: asNumber(event.actualTick),
      },
    ];
  });

  const generalEntries = (currentScenarioPayload?.news || []).map((item, index) => ({
    id: `news-${index}-${asNumber(item.tick)}`,
    tick: asNumber(item.tick),
    token: "News",
    label: item.headline || "News",
    value: item.headline || "—",
    impactPct: impactPctForNewsItem(item),
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
  if (chartApi) return;
  const el = document.getElementById("adminChart");
  chartApi = LightweightCharts.createChart(el, {
    layout: { background: { color: "#0d1423" }, textColor: "#e7efff" },
    grid: { vertLines: { color: "#1b2b45" }, horzLines: { color: "#1b2b45" } },
    rightPriceScale: { borderColor: "#1b2b45" },
    timeScale: { borderColor: "#1b2b45", timeVisible: true },
  });

  priceSeries = chartApi.addLineSeries({ color: "#6da8ff", lineWidth: 2, title: "Price" });
  fairSeries = chartApi.addLineSeries({ color: "#ffd84d", lineWidth: 2, title: "Fair Value" });
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

function renderAssets() {
  assetsList.innerHTML = "";
  const inTab = assets.filter((asset) => (asset.category || "equities") === activeTab);

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
      group.items.forEach((asset) => assetsList.appendChild(assetRow(asset)));
    });
  } else {
    inTab.forEach((asset) => assetsList.appendChild(assetRow(asset)));
  }
}

function assetRow(asset) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "asset-row";
  row.dataset.asset = asset.id;
  row.classList.toggle("active", asset.id === selectedAssetId);
  row.innerHTML = `<span class="asset-symbol">${asset.symbol}</span><span class="asset-price">${fmt(asset.price, asset.isYield ? 3 : 2)}</span><span class="asset-position">FV</span><span class="asset-pnl">${fmt(asset.fairValue, asset.isYield ? 3 : 2)}</span>`;
  row.addEventListener("click", () => selectAsset(asset.id));
  return row;
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

  const candles = [...(asset.candles || [])];
  if (asset.candle) candles.push(asset.candle);
  priceSeries.setData(candles.map((c) => ({ time: c.time, value: c.close })));
  fairSeries.setData(candles.map((c) => ({ time: c.time, value: asset.fairValue })));
}

function updateChartAsset(asset) {
  if (!priceSeries || selectedAssetId !== asset.id) return;
  if (asset.completedCandle) {
    priceSeries.update({ time: asset.completedCandle.time, value: asset.completedCandle.close });
    fairSeries.update({ time: asset.completedCandle.time, value: asset.fairValue });
  }
  if (asset.candle) {
    priceSeries.update({ time: asset.candle.time, value: asset.candle.close });
    fairSeries.update({ time: asset.candle.time, value: asset.fairValue });
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

function fetchPlayers() {
  const rows = [];
  playersTbody.innerHTML = "";
  rows.forEach((player) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${player.name || "—"}</td><td>${player.runId || "—"}</td><td>${player.joinedAt ? new Date(player.joinedAt).toLocaleString() : "—"}</td><td>${player.status || "active"}</td><td>${player.latestScore ?? "—"}</td>`;
    playersTbody.appendChild(tr);
  });
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
  assets = payload.assets || [];
  assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  renderTabs();
  renderAssets();
  if (!selectedAssetId && assets.length) selectAsset(assets[0].id);
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
    if (update.completedCandle) {
      asset.candles.push(update.completedCandle);
    }
    updateChartAsset(asset);
  });
  renderAssets();
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
fetchPlayers();
