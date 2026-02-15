const socket = io({ transports: ["websocket", "polling"], upgrade: true });

const runId = new URLSearchParams(window.location.search).get("run_id");
const backendUrl = import.meta.env?.VITE_BACKEND_URL || window.APP_CONFIG?.VITE_BACKEND_URL || "";
const mintSiteUrl = import.meta.env?.VITE_MINT_SITE_URL || window.APP_CONFIG?.VITE_MINT_SITE_URL || "";
const isDebugSubmissionEnabled =
  import.meta.env?.DEV ||
  window.APP_CONFIG?.NODE_ENV !== "production" ||
  new URLSearchParams(window.location.search).get("debug_submit") === "1";

const runErrorView = document.getElementById("runErrorView");
const mintHomeLink = document.getElementById("mintHomeLink");
const joinView = document.getElementById("joinView");
const waitView = document.getElementById("waitView");
const gameView = document.getElementById("gameView");
const rosterUl = document.getElementById("roster");
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

function show(node) {
  if (node) node.classList.remove("hidden");
}

function hide(node) {
  if (node) node.classList.add("hidden");
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return Number(value).toFixed(digits);
}

function formatCurrency(value) {
  if (!Number.isFinite(value)) return "—";
  return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSigned(value) {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "" : "";
  return `${sign}${value.toFixed(2)}`;
}

function formatSignedCurrency(value) {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatCurrency(Math.abs(value))}`;
}

function getPositionData(assetId) {
  return positions.get(assetId) || { position: 0, avgCost: 0, realizedPnl: 0 };
}

function pnlForAsset(asset) {
  const posData = getPositionData(asset.id);
  const unrealized = posData.position ? (asset.price - posData.avgCost) * posData.position : 0;
  const realized = posData.realizedPnl || 0;
  return { total: realized + unrealized, unrealized, realized };
}

function refreshDrawdownMetrics(currentEquity) {
  highestEquity = Math.max(highestEquity, currentEquity);
  const drawdown = highestEquity - currentEquity;
  maxDrawdown = Math.max(maxDrawdown, drawdown);
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
  refreshDrawdownMetrics(availableCash + totalPnlValue);

  posLbl.textContent = formatCurrency(positionValue);
  if (cashLbl) cashLbl.textContent = formatCurrency(availableCash);
  if (openPnlLbl) {
    openPnlLbl.textContent = formatSignedCurrency(openPnl);
    openPnlLbl.classList.toggle("positive", openPnl > 0);
    openPnlLbl.classList.toggle("negative", openPnl < 0);
  }
  pnlLbl.textContent = formatSignedCurrency(totalPnl);
  pnlLbl.classList.toggle("positive", totalPnl > 0);
  pnlLbl.classList.toggle("negative", totalPnl < 0);
}

function setTradeStatus(message, tone = "") {
  if (!tradeStatus) return;
  tradeStatus.textContent = message;
  tradeStatus.dataset.tone = tone;
}

function setResultMessage(message) {
  if (resultMessage) resultMessage.textContent = message;
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

function addResultLink(label, href) {
  const link = document.createElement("a");
  link.className = "button-link";
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = label;
  resultActions?.appendChild(link);
}

function renderAssetsList() {
  assetsList.innerHTML = "";
  assets.forEach((asset) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "asset-row";
    row.dataset.asset = asset.id;

    const symbol = document.createElement("span");
    symbol.className = "asset-symbol";
    symbol.textContent = asset.symbol;

    const price = document.createElement("span");
    price.className = "asset-price";
    price.textContent = formatNumber(asset.price, 2);

    const position = document.createElement("span");
    position.className = "asset-position";
    position.textContent = "0";

    const pnl = document.createElement("span");
    pnl.className = "asset-pnl";
    pnl.textContent = "0.00";

    row.append(symbol, price, position, pnl);
    row.addEventListener("click", () => selectAsset(asset.id));

    assetsList.appendChild(row);
  });

  updateAssetsListValues();
}

function updateAssetsListValues() {
  assets.forEach((asset) => {
    const row = assetsList.querySelector(`[data-asset="${asset.id}"]`);
    if (!row) return;
    const priceEl = row.querySelector(".asset-price");
    const positionEl = row.querySelector(".asset-position");
    const pnlEl = row.querySelector(".asset-pnl");
    const posData = getPositionData(asset.id);
    const pnlData = pnlForAsset(asset);

    priceEl.textContent = formatNumber(asset.price, 2);
    positionEl.textContent = posData.position.toFixed(0);
    pnlEl.textContent = formatSigned(pnlData.total);
    pnlEl.classList.toggle("positive", pnlData.total > 0);
    pnlEl.classList.toggle("negative", pnlData.total < 0);
    row.classList.toggle("has-position", Math.abs(posData.position) > 0);
  });
  updatePortfolioSummary();
}

function updateAssetSelectionStyles() {
  assetsList.querySelectorAll(".asset-row").forEach((row) => {
    row.classList.toggle("active", row.dataset.asset === selectedAssetId);
  });
}

function ensureChart() {
  if (chartApi || !chartContainer) return;
  chartApi = LightweightCharts.createChart(chartContainer, {
    layout: {
      background: { color: "#0d1423" },
      textColor: "#e7efff",
    },
    grid: {
      vertLines: { color: "#1b2b45" },
      horzLines: { color: "#1b2b45" },
    },
    timeScale: {
      borderColor: "#1b2b45",
      timeVisible: true,
      secondsVisible: false,
    },
    rightPriceScale: {
      borderColor: "#1b2b45",
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
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
    if (!chartApi) return;
    chartApi.applyOptions({
      width: chartContainer.clientWidth,
      height: chartContainer.clientHeight,
    });
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
    lineStyle: 0,
    axisLabelVisible: true,
    title: "Avg",
  });
}

function selectAsset(assetId) {
  const asset = assetMap.get(assetId);
  if (!asset) return;
  selectedAssetId = assetId;
  orderAssetLabel.textContent = asset.symbol;
  updateAssetSelectionStyles();
  ensureChart();

  const candleData = [...asset.candles];
  if (asset.candle) {
    candleData.push(asset.candle);
  }
  candleSeriesApi.setData(candleData);
  updateAverageLine(asset);
  renderOpenOrders();
}

function updateChartForAsset(asset) {
  if (!candleSeriesApi || selectedAssetId !== asset.id) return;
  if (asset.completedCandle) {
    candleSeriesApi.update(asset.completedCandle);
  }
  if (asset.candle) {
    candleSeriesApi.update(asset.candle);
  }
}

function renderOpenOrders() {
  if (!openOrdersList) return;
  openOrdersList.innerHTML = "";
  const assetOrders = openOrders.filter((order) => order.assetId === selectedAssetId);
  if (!assetOrders.length) {
    const empty = document.createElement("li");
    empty.className = "empty-order";
    empty.textContent = "No open orders";
    openOrdersList.appendChild(empty);
    return;
  }

  assetOrders.forEach((order) => {
    const item = document.createElement("li");
    const info = document.createElement("div");
    info.className = "order-info";
    const title = document.createElement("span");
    title.innerHTML = `<strong class="side-${order.side}">${order.side.toUpperCase()}</strong> ${order.qty} @ ${formatNumber(order.price, 2)}`;
    const meta = document.createElement("span");
    meta.className = "order-meta";
    meta.textContent = `${order.type.toUpperCase()} • ${new Date(order.t).toLocaleTimeString()}`;
    info.append(title, meta);
    item.append(info);
    openOrdersList.appendChild(item);
  });
}

function handleOrder(side) {
  if (!selectedAssetId) {
    setTradeStatus("Select an asset first.", "error");
    return;
  }
  const qty = Number(quantityInput.value || 0);
  const payload = {
    assetId: selectedAssetId,
    side,
    qty,
    type: "market",
  };

  socket.emit("submitOrder", payload, (res) => {
    if (!res?.ok) {
      setTradeStatus("Order rejected.", "error");
      return;
    }
    setTradeStatus(res.filled ? "Order filled." : "Order placed.", "success");
  });
}

function buildSubmissionPayload({ useSample = false } = {}) {
  const score = Number((useSample ? 1234.56 : totalPnlValue).toFixed(2));
  const pnl = Number((useSample ? 789.12 : totalPnlValue).toFixed(2));
  const winRate = Number((useSample ? 0.67 : totalTrades ? winTrades / totalTrades : 0).toFixed(4));
  const drawdownValue = Number((useSample ? 250.34 : maxDrawdown).toFixed(2));

  return {
    runId,
    score,
    pnl,
    max_drawdown: drawdownValue,
    win_rate: winRate,
    extra: {
      cash: availableCash,
      trades: totalTrades,
      winningTrades: winTrades,
      positions: Array.from(positions.entries()).map(([assetId, data]) => ({
        assetId,
        position: data.position,
        avgCost: data.avgCost,
        realizedPnl: data.realizedPnl ?? 0,
      })),
      submittedAt: new Date().toISOString(),
      mode: useSample ? "debug" : "live",
    },
  };
}

async function submitResults(payload) {
  if (!backendUrl) {
    setResultMessage("Could not submit results. Retry");
    clearResultActions();
    addResultButton("Retry", () => {
      if (latestSubmissionPayload) submitResults(latestSubmissionPayload);
    });
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

    if (!response.ok) {
      throw new Error(`submit-failed-${response.status}`);
    }

    hasSubmittedRun = true;
    setResultMessage("Results submitted.");
    clearResultActions();
    if (mintSiteUrl) {
      addResultLink("View results on Mint", `${mintSiteUrl}/multiplayer/runs/${runId}`);
    } else {
      const runText = document.createElement("p");
      runText.className = "muted";
      runText.textContent = `runId: ${runId}`;
      resultActions?.appendChild(runText);
    }
  } catch (_error) {
    setResultMessage("Could not submit results. Retry");
    clearResultActions();
    addResultButton("Retry", () => {
      if (latestSubmissionPayload) submitResults(latestSubmissionPayload);
    });
  }
}

function submitLiveResults() {
  if (!runId || hasSubmittedRun) return;
  submitResults(buildSubmissionPayload({ useSample: false }));
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

socket.on("phase", (phase) => {
  if (phaseBadge) {
    phaseBadge.textContent = `Phase: ${phase}`;
  }
  if (["ended", "finished", "complete"].includes(String(phase).toLowerCase())) {
    submitLiveResults();
  }
});

socket.on("assetSnapshot", (payload) => {
  assets = payload.assets || [];
  assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  renderAssetsList();
  if (assets.length && !selectedAssetId) {
    selectAsset(assets[0].id);
  }
});

socket.on("assetTick", (payload) => {
  if (!payload?.assets) return;
  payload.assets.forEach((update) => {
    const asset = assetMap.get(update.id);
    if (!asset) return;
    asset.price = update.price;
    if (update.completedCandle) {
      asset.candles.push(update.completedCandle);
      if (asset.candles.length > 50) {
        asset.candles.shift();
      }
    }
    asset.candle = update.candle;
    asset.completedCandle = update.completedCandle;
    updateChartForAsset(asset);
  });
  updateAssetsListValues();
  if (selectedAssetId) {
    const asset = assetMap.get(selectedAssetId);
    if (asset) {
      updateAverageLine(asset);
    }
  }
  updatePortfolioSummary();
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
  if (Number.isFinite(payload?.cash)) {
    availableCash = payload.cash;
  }
  updateAssetsListValues();
  if (selectedAssetId) {
    const asset = assetMap.get(selectedAssetId);
    if (asset) {
      updateAverageLine(asset);
    }
  }
  updatePortfolioSummary();
});

socket.on("execution", (payload) => {
  const tradePnl = Number(payload?.realizedPnlDelta ?? payload?.pnlDelta ?? 0);
  totalTrades += 1;
  if (tradePnl > 0) {
    winTrades += 1;
  }
});

socket.on("openOrders", (payload) => {
  openOrders = payload?.orders || [];
  renderOpenOrders();
});

buyBtn?.addEventListener("click", () => handleOrder("buy"));
sellBtn?.addEventListener("click", () => handleOrder("sell"));

joinBtn?.addEventListener("click", () => {
  const name = nameInput.value.trim();
  if (!name) {
    joinMsg.textContent = "Enter a name to join.";
    return;
  }
  socket.emit("join", name, (res) => {
    if (!res?.ok) {
      joinMsg.textContent = "Unable to join.";
      return;
    }
    hide(joinView);
    hide(waitView);
    show(gameView);
    if (res.assets) {
      assets = res.assets;
      assetMap = new Map(assets.map((asset) => [asset.id, asset]));
      renderAssetsList();
      if (!selectedAssetId && assets.length) {
        selectAsset(assets[0].id);
      }
    }
  });
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && document.activeElement === nameInput) {
    joinBtn.click();
  }
});

document.querySelectorAll("[data-fullscreen]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
      btn.dataset.active = "true";
    } else {
      document.exitFullscreen?.();
      btn.dataset.active = "false";
    }
  });
});

if (mintHomeLink) {
  mintHomeLink.href = mintSiteUrl || "/";
}

if (runIdLabel) {
  runIdLabel.textContent = runId ? `Run: ${runId}` : "Run: missing";
}

if (!runId) {
  hide(joinView);
  hide(waitView);
  hide(gameView);
  show(runErrorView);
} else {
  setResultMessage("Results will be submitted when the round ends.");
}

if (submitTestBtn && runId && isDebugSubmissionEnabled) {
  show(submitTestBtn);
  submitTestBtn.addEventListener("click", () => {
    submitResults(buildSubmissionPayload({ useSample: true }));
  });
}

updatePortfolioSummary();
