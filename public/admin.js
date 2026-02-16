const query = new URLSearchParams(window.location.search);
const eventCode = query.get("event_code") || query.get("event_id") || "";
const adminToken = query.get("admin_token") || "";
const scenarioId = query.get("scenario_id") || "";
const backendUrl = import.meta.env?.VITE_BACKEND_URL || window.APP_CONFIG?.VITE_BACKEND_URL || "";

const TAB_ORDER = ["equities", "commodities", "bonds"];
const TAB_LABELS = { equities: "Equities", commodities: "Commodities", bonds: "Bonds" };

const authState = document.getElementById("authState");
const adminMain = document.getElementById("adminMain");
const phaseBadge = document.getElementById("adminPhaseBadge");
const playersTbody = document.getElementById("playersTbody");
const controlStatus = document.getElementById("controlStatus");
const assetTabs = document.getElementById("adminAssetTabs");
const assetsList = document.getElementById("adminAssetsList");
const selectedAssetLabel = document.getElementById("selectedAssetLabel");
const adminScenarioLabel = document.getElementById("adminScenarioLabel");

let activeTab = "equities";
let selectedAssetId = null;
let assets = [];
let assetMap = new Map();
let chartApi = null;
let priceSeries = null;
let fairSeries = null;
let authorized = false;

const socket = io({ transports: ["websocket", "polling"], query: { role: "admin", event_code: eventCode, scenario_id: scenarioId } });

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


async function loadScenarioLabel() {
  if (!scenarioId) {
    if (adminScenarioLabel) {
      adminScenarioLabel.textContent = "Scenario: missing";
    }
    return;
  }

  try {
    const response = await fetch(`/scenarios/${encodeURIComponent(scenarioId)}.json`, { cache: "no-store" });
    if (!response.ok) throw new Error("missing");
    const scenario = await response.json();
    if (adminScenarioLabel) {
      adminScenarioLabel.textContent = `Scenario: ${scenario.name || scenarioId} (${scenario.id || scenarioId})`;
    }
  } catch {
    if (adminScenarioLabel) {
      adminScenarioLabel.textContent = `Scenario: ${scenarioId} (not found)`;
    }
  }
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

async function validateToken() {
  if (!backendUrl || !eventCode || !adminToken) {
    authState.textContent = "Not authorized";
    return;
  }

  try {
    const url = `${backendUrl}/api/admin/validate-token?event_code=${encodeURIComponent(eventCode)}&admin_token=${encodeURIComponent(adminToken)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("unauthorized");
    const payload = await response.json();
    if (!payload?.ok) throw new Error("unauthorized");

    authorized = true;
    authState.classList.add("hidden");
    adminMain.classList.remove("hidden");
  } catch {
    authState.textContent = "Not authorized";
  }
}

async function runControl(action, localPhase) {
  if (!authorized || !backendUrl) return;
  setControlStatus(`${action} requested...`);
  try {
    const response = await fetch(`${backendUrl}/api/admin/events/${encodeURIComponent(eventCode)}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": adminToken },
      body: JSON.stringify({ admin_token: adminToken }),
    });

    if (!response.ok) throw new Error(`failed-${response.status}`);

    setControlStatus(`${action} confirmed`, "success");
    setPhase(localPhase);
    socket.emit("adminPhaseSync", { phase: localPhase });
  } catch {
    setControlStatus(`${action} failed`, "error");
  }
}

async function fetchPlayers() {
  if (!authorized || !backendUrl) return;
  try {
    const response = await fetch(`${backendUrl}/api/events/${encodeURIComponent(eventCode)}/players`);
    if (!response.ok) return;
    const payload = await response.json();
    const players = payload.players || [];

    playersTbody.innerHTML = "";
    players.forEach((player) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${player.name || "—"}</td><td>${player.runId || "—"}</td><td>${player.joinedAt ? new Date(player.joinedAt).toLocaleString() : "—"}</td><td>${player.status || "active"}</td><td>${player.latestScore ?? "—"}</td>`;
      playersTbody.appendChild(tr);
    });
  } catch {
    // noop
  }
}

document.getElementById("startBtn")?.addEventListener("click", () => runControl("start", "running"));
document.getElementById("pauseBtn")?.addEventListener("click", () => runControl("pause", "paused"));
document.getElementById("resumeBtn")?.addEventListener("click", () => runControl("resume", "running"));
document.getElementById("endBtn")?.addEventListener("click", () => runControl("end", "ended"));

socket.on("phase", setPhase);
socket.on("adminAssetSnapshot", (payload) => {
  if (payload?.scenario && adminScenarioLabel) {
    adminScenarioLabel.textContent = `Scenario: ${payload.scenario.name || payload.scenario.id} (${payload.scenario.id || scenarioId})`;
  }
  assets = payload.assets || [];
  assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  renderTabs();
  renderAssets();
  if (!selectedAssetId && assets.length) selectAsset(assets[0].id);
});

socket.on("adminAssetTick", (payload) => {
  (payload.assets || []).forEach((update) => {
    const asset = assetMap.get(update.id);
    if (!asset) return;
    asset.price = update.price;
    asset.fairValue = update.fairValue;
    asset.candle = update.candle;
    asset.completedCandle = update.completedCandle;
    if (update.completedCandle) {
      asset.candles.push(update.completedCandle);
      if (asset.candles.length > 80) asset.candles.shift();
    }
    updateChartAsset(asset);
  });
  renderAssets();
});

socket.on("scenarioError", (payload) => {
  setControlStatus(payload?.message || "Scenario not found. Launch from Mint.", "error");
});

await loadScenarioLabel();
await validateToken();
await fetchPlayers();
setInterval(fetchPlayers, 5000);
