const socket = io({ transports: ["websocket", "polling"], upgrade: true });

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
const pnlLbl = document.getElementById("pnlLbl");
const assetsList = document.getElementById("assetsList");
const orderAssetLabel = document.getElementById("orderAssetLabel");

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

function formatSigned(value) {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "" : "";
  return `${sign}${value.toFixed(2)}`;
}

function getPositionData(assetId) {
  return positions.get(assetId) || { position: 0, avgCost: 0, realizedPnl: 0 };
}

function pnlForAsset(asset) {
  const posData = getPositionData(asset.id);
  const unrealized = posData.position ? (asset.price - posData.avgCost) * posData.position : 0;
  return (posData.realizedPnl || 0) + unrealized;
}

function updateTotalPnl() {
  const total = assets.reduce((sum, asset) => sum + pnlForAsset(asset), 0);
  pnlLbl.textContent = formatSigned(total);
  pnlLbl.classList.toggle("positive", total > 0);
  pnlLbl.classList.toggle("negative", total < 0);
}

function updateHeaderForAsset(asset) {
  if (!asset) return;
  const posData = getPositionData(asset.id);
  posLbl.textContent = posData.position.toFixed(0);
}

function setTradeStatus(message, tone = "") {
  tradeStatus.textContent = message;
  tradeStatus.dataset.tone = tone;
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
    const pnl = pnlForAsset(asset);

    priceEl.textContent = formatNumber(asset.price, 2);
    positionEl.textContent = posData.position.toFixed(0);
    pnlEl.textContent = formatSigned(pnl);
    pnlEl.classList.toggle("positive", pnl > 0);
    pnlEl.classList.toggle("negative", pnl < 0);
  });
  updateTotalPnl();
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
  updateHeaderForAsset(asset);
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
      updateHeaderForAsset(asset);
      updateAverageLine(asset);
    }
  }
  updateTotalPnl();
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
  updateAssetsListValues();
  if (selectedAssetId) {
    const asset = assetMap.get(selectedAssetId);
    if (asset) {
      updateHeaderForAsset(asset);
      updateAverageLine(asset);
    }
  }
  updateTotalPnl();
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

updateTotalPnl();
