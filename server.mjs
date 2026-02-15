import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/assets", express.static(path.join(__dirname, "public/assets")));
app.get("/healthz", (_req, res) => res.send("ok"));

app.get("/app-config.js", (_req, res) => {
  const config = {
    VITE_BACKEND_URL: process.env.VITE_BACKEND_URL || "",
    VITE_MINT_URL: process.env.VITE_MINT_URL || process.env.VITE_MINT_SITE_URL || "",
    NODE_ENV: process.env.NODE_ENV || "development",
  };
  res.type("application/javascript");
  res.send(`window.APP_CONFIG = ${JSON.stringify(config)};`);
});

const PORT = process.env.PORT || 10000;

const TICK_MS = 500;
const TICKS_PER_CANDLE = 10;
const MAX_CANDLES = 50;

const ASSET_SYMBOLS = [
  "ALPHA",
  "BRAVO",
  "CRUX",
  "DELTA",
  "ECHO",
  "FALCON",
  "GAMMA",
  "HELIX",
  "ION",
  "JUNO",
];

const players = new Map();
const DEFAULT_CASH = 100000;
let tickTimer = null;

function tickSizeForStartPrice(startPrice) {
  if (startPrice > 500) return 1;
  if (startPrice >= 250) return 0.5;
  if (startPrice >= 100) return 0.25;
  return 0.1;
}

function snapToTick(value, tickSize) {
  if (!Number.isFinite(tickSize) || tickSize <= 0) return value;
  const snapped = Math.round(value / tickSize) * tickSize;
  return Number(snapped.toFixed(4));
}

function biasedStep(asset) {
  const fairValue = asset.fairValue || asset.price;
  const deviationPct = fairValue ? ((asset.price - fairValue) / fairValue) * 100 : 0;
  const absDeviation = Math.abs(deviationPct);
  let bias = 0;
  if (absDeviation >= 2) {
    bias = Math.min(0.45, 0.05 + Math.max(0, absDeviation - 2) * 0.02);
  }
  let upProbability = 0.5;
  if (absDeviation >= 2) {
    upProbability = deviationPct < 0 ? 0.5 + bias : 0.5 - bias;
  }
  return Math.random() < upProbability ? 1 : -1;
}

function buildInitialCandles(startPrice, tickSize) {
  let price = startPrice;
  const candles = [];
  const startTime = Math.floor(Date.now() / 1000) - MAX_CANDLES * TICKS_PER_CANDLE;
  for (let i = 0; i < MAX_CANDLES; i += 1) {
    const time = startTime + i * TICKS_PER_CANDLE;
    let open = price;
    let high = price;
    let low = price;
    for (let t = 0; t < TICKS_PER_CANDLE; t += 1) {
      price = snapToTick(price + (Math.random() < 0.5 ? -1 : 1) * tickSize, tickSize);
      high = Math.max(high, price);
      low = Math.min(low, price);
    }
    const close = price;
    candles.push({ time, open, high, low, close });
  }
  return { candles, price };
}

function createAsset(symbol, index) {
  const seed = 90 + index * 15;
  const tickSize = tickSizeForStartPrice(seed);
  const initial = buildInitialCandles(seed, tickSize);
  const lastTime = initial.candles[initial.candles.length - 1]?.time ?? Math.floor(Date.now() / 1000);
  return {
    id: `asset-${index + 1}`,
    symbol,
    price: initial.price,
    fairValue: seed,
    tickSize,
    candles: initial.candles,
    currentCandle: {
      time: lastTime + TICKS_PER_CANDLE,
      open: initial.price,
      high: initial.price,
      low: initial.price,
      close: initial.price,
    },
    ticksInCandle: 0,
    nextCandleTime: lastTime + TICKS_PER_CANDLE,
  };
}

const assets = ASSET_SYMBOLS.map((symbol, index) => createAsset(symbol, index));

function ensurePosition(player, assetId) {
  if (!player.positions[assetId]) {
    player.positions[assetId] = { position: 0, avgCost: 0, realizedPnl: 0 };
  }
  return player.positions[assetId];
}

function applyFillToPosition(positionData, qtySigned, price) {
  const { position, avgCost } = positionData;
  if (!Number.isFinite(positionData.realizedPnl)) {
    positionData.realizedPnl = 0;
  }
  const newPos = position + qtySigned;

  if (position === 0) {
    positionData.position = newPos;
    positionData.avgCost = newPos === 0 ? 0 : price;
    return;
  }

  if (Math.sign(position) === Math.sign(qtySigned)) {
    positionData.position = newPos;
    positionData.avgCost = newPos === 0 ? 0 : (position * avgCost + qtySigned * price) / newPos;
    return;
  }

  const closingQty = Math.min(Math.abs(position), Math.abs(qtySigned));
  const realizedChange = (price - avgCost) * closingQty * Math.sign(position);
  positionData.realizedPnl += realizedChange;

  if (newPos === 0) {
    positionData.position = 0;
    positionData.avgCost = 0;
    return;
  }

  if (Math.sign(newPos) === Math.sign(position)) {
    positionData.position = newPos;
    return;
  }

  positionData.position = newPos;
  positionData.avgCost = price;
}

function computePositionPnl(positionData, assetPrice) {
  const unrealized = positionData.position ? (assetPrice - positionData.avgCost) * positionData.position : 0;
  return positionData.realizedPnl + unrealized;
}

function publishPortfolio(player) {
  const positions = Object.entries(player.positions).map(([assetId, data]) => ({
    assetId,
    position: data.position,
    avgCost: data.avgCost,
    realizedPnl: data.realizedPnl ?? 0,
    pnl: computePositionPnl(data, assets.find((asset) => asset.id === assetId)?.price ?? 0),
  }));
  const socket = io.sockets.sockets.get(player.id);
  if (socket) {
    socket.emit("portfolio", { positions, cash: player.cash });
    socket.emit("openOrders", { orders: player.orders });
  }
}

function fillOrder(player, order, asset) {
  const positionData = ensurePosition(player, order.assetId);
  const qtySigned = order.side === "buy" ? order.qty : -order.qty;
  const prevAbs = Math.abs(positionData.position);
  applyFillToPosition(positionData, qtySigned, order.price);
  const nextAbs = Math.abs(positionData.position);
  const absDelta = nextAbs - prevAbs;
  if (absDelta > 0) {
    player.cash -= absDelta * order.price;
  } else if (absDelta < 0) {
    player.cash += Math.abs(absDelta) * order.price;
  }
  const socket = io.sockets.sockets.get(player.id);
  if (socket) {
    socket.emit("execution", {
      assetId: order.assetId,
      side: order.side,
      qty: order.qty,
      price: order.price,
      t: Date.now(),
    });
  }
  publishPortfolio(player);
  asset.lastTrade = {
    price: order.price,
    side: order.side,
    t: Date.now(),
  };
}

function processLimitOrdersForAsset(asset) {
  const filledOrderIds = new Set();
  for (const player of players.values()) {
    for (const order of player.orders) {
      if (order.assetId !== asset.id || order.type !== "limit") continue;
      if (filledOrderIds.has(order.id)) continue;
      if (order.side === "buy" && asset.price <= order.price) {
        fillOrder(player, order, asset);
        filledOrderIds.add(order.id);
      } else if (order.side === "sell" && asset.price >= order.price) {
        fillOrder(player, order, asset);
        filledOrderIds.add(order.id);
      }
    }
    if (filledOrderIds.size) {
      player.orders = player.orders.filter((order) => !filledOrderIds.has(order.id));
      publishPortfolio(player);
    }
  }
}

function stepTick() {
  const updates = [];
  for (const asset of assets) {
    const direction = biasedStep(asset);
    asset.price = snapToTick(asset.price + direction * asset.tickSize, asset.tickSize);

    if (!asset.currentCandle) {
      asset.currentCandle = {
        time: asset.nextCandleTime,
        open: asset.price,
        high: asset.price,
        low: asset.price,
        close: asset.price,
      };
      asset.ticksInCandle = 0;
    }

    asset.currentCandle.close = asset.price;
    asset.currentCandle.high = Math.max(asset.currentCandle.high, asset.price);
    asset.currentCandle.low = Math.min(asset.currentCandle.low, asset.price);
    asset.ticksInCandle += 1;

    let isNewCandle = false;
    let completedCandle = null;
    if (asset.ticksInCandle >= TICKS_PER_CANDLE) {
      completedCandle = asset.currentCandle;
      asset.candles.push(completedCandle);
      if (asset.candles.length > MAX_CANDLES) {
        asset.candles.shift();
      }
      asset.nextCandleTime += TICKS_PER_CANDLE;
      asset.currentCandle = null;
      asset.ticksInCandle = 0;
      isNewCandle = true;
    }

    processLimitOrdersForAsset(asset);

    updates.push({
      id: asset.id,
      symbol: asset.symbol,
      price: asset.price,
      candle: asset.currentCandle,
      isNewCandle,
      completedCandle,
      lastTrade: asset.lastTrade || null,
    });
  }

  io.emit("assetTick", { assets: updates });
}

function startTicking() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(stepTick, TICK_MS);
}

function initialAssetPayload() {
  return assets.map((asset) => ({
    id: asset.id,
    symbol: asset.symbol,
    price: asset.price,
    candles: asset.candles,
    candle: asset.currentCandle,
  }));
}

io.on("connection", (socket) => {
  socket.emit("phase", "running");
  socket.emit("assetSnapshot", { assets: initialAssetPayload(), tickMs: TICK_MS });

  socket.on("join", (name, ack) => {
    const nm = String(name || "Player").trim() || "Player";
    players.set(socket.id, {
      id: socket.id,
      name: nm,
      positions: {},
      orders: [],
      cash: DEFAULT_CASH,
    });
    ack?.({ ok: true, phase: "running", assets: initialAssetPayload(), tickMs: TICK_MS });
    publishPortfolio(players.get(socket.id));
  });

  socket.on("submitOrder", (order, ack) => {
    const player = players.get(socket.id);
    if (!player) {
      ack?.({ ok: false, reason: "not-joined" });
      return;
    }
    const asset = assets.find((item) => item.id === order?.assetId);
    if (!asset) {
      ack?.({ ok: false, reason: "unknown-asset" });
      return;
    }
    const qty = Math.max(1, Math.floor(Number(order?.qty || 0)));
    const side = order?.side === "sell" ? "sell" : "buy";
    const type = order?.type === "limit" ? "limit" : "market";
    const limitPrice = Number(order?.price);

    if (!Number.isFinite(qty) || qty <= 0) {
      ack?.({ ok: false, reason: "bad-qty" });
      return;
    }

    if (side === "buy" && type === "market" && qty * asset.price > player.cash) {
      ack?.({ ok: false, reason: "insufficient-cash" });
      return;
    }

    if (type === "market") {
      fillOrder(player, {
        assetId: asset.id,
        side,
        qty,
        price: asset.price,
      }, asset);
      ack?.({ ok: true, filled: true });
      return;
    }

    if (!Number.isFinite(limitPrice)) {
      ack?.({ ok: false, reason: "bad-price" });
      return;
    }

    if (side === "buy" && qty * limitPrice > player.cash) {
      ack?.({ ok: false, reason: "insufficient-cash" });
      return;
    }

    const orderData = {
      id: `order-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      assetId: asset.id,
      side,
      qty,
      price: Number(limitPrice.toFixed(2)),
      type,
      t: Date.now(),
    };
    player.orders.push(orderData);
    publishPortfolio(player);
    ack?.({ ok: true, filled: false });
  });

  socket.on("cancelOrders", (assetId) => {
    const player = players.get(socket.id);
    if (!player) return;
    if (assetId) {
      player.orders = player.orders.filter((order) => order.assetId !== assetId);
    } else {
      player.orders = [];
    }
    publishPortfolio(player);
  });

  socket.on("closePosition", (assetId) => {
    const player = players.get(socket.id);
    if (!player) return;
    const asset = assets.find((item) => item.id === assetId);
    if (!asset) return;
    const positionData = ensurePosition(player, assetId);
    if (positionData.position === 0) return;
    const side = positionData.position > 0 ? "sell" : "buy";
    const qty = Math.abs(positionData.position);
    fillOrder(player, { assetId, side, qty, price: asset.price }, asset);
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
  });
});

startTicking();

server.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
