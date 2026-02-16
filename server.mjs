import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import fs from "fs";
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
app.use("/scenarios", express.static(path.join(__dirname, "scenarios")));
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
const DEFAULT_CASH = 100000;
const backendUrl = process.env.VITE_BACKEND_URL || "";

const scenariosPath = path.join(__dirname, "scenarios");
const fallbackScenarioId = process.env.DEFAULT_SCENARIO_ID || "global-macro";

function safeJsonRead(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function loadScenarioExact(scenarioId) {
  const wanted = String(scenarioId || "").trim();
  if (!wanted) return null;
  const exact = path.join(scenariosPath, `${wanted}.json`);
  return fs.existsSync(exact) ? safeJsonRead(exact) : null;
}

function loadScenario(scenarioId) {
  return loadScenarioExact(scenarioId) || loadScenarioExact(fallbackScenarioId);
}

function listScenarios() {
  if (!fs.existsSync(scenariosPath)) return [];
  return fs
    .readdirSync(scenariosPath)
    .filter((name) => name.endsWith(".json"))
    .map((name) => safeJsonRead(path.join(scenariosPath, name)))
    .filter(Boolean)
    .map((scenario) => ({
      id: scenario.id,
      name: scenario.name || scenario.id || "Unnamed scenario",
      duration_seconds: Number(scenario.duration_seconds || scenario.durationSeconds || 0),
      description: scenario.description || "",
      version: scenario.version || "1.0.0",
    }))
    .filter((scenario) => scenario.id)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function quantize(value, decimals = 2) {
  const p = 10 ** decimals;
  return Math.round(value * p) / p;
}

function buildInitialCandles(startPrice, decimals, maxCandles, ticksPerCandle) {
  const candles = [];
  let price = startPrice;
  const startTime = Math.floor(Date.now() / 1000) - maxCandles * ticksPerCandle;
  for (let i = 0; i < maxCandles; i += 1) {
    const time = startTime + i * ticksPerCandle;
    let open = price;
    let high = price;
    let low = price;
    for (let tick = 0; tick < ticksPerCandle; tick += 1) {
      const wiggle = (Math.random() - 0.5) * 0.003;
      price = quantize(Math.max(0.01, price * (1 + wiggle)), decimals);
      high = Math.max(high, price);
      low = Math.min(low, price);
    }
    candles.push({ time, open, high, low, close: price });
  }
  return { candles, price };
}

function createAssetState(assetDef, simCfg) {
  const decimals = Number.isFinite(assetDef.priceDecimals) ? assetDef.priceDecimals : 2;
  const initial = buildInitialCandles(assetDef.startPrice, decimals, simCfg.maxCandles, simCfg.ticksPerCandle);
  const lastCandleTime = initial.candles[initial.candles.length - 1]?.time ?? Math.floor(Date.now() / 1000);

  return {
    id: assetDef.id,
    symbol: assetDef.symbol,
    name: assetDef.name,
    category: assetDef.category,
    group: assetDef.group || null,
    isYield: Boolean(assetDef.isYield),
    decimals,
    basePrice: assetDef.startPrice,
    factors: assetDef.factors || {},
    price: quantize(initial.price, decimals),
    fairValue: quantize(assetDef.startPrice, decimals),
    candles: initial.candles,
    currentCandle: {
      time: lastCandleTime + simCfg.ticksPerCandle,
      open: initial.price,
      high: initial.price,
      low: initial.price,
      close: initial.price,
    },
    ticksInCandle: 0,
    nextCandleTime: lastCandleTime + simCfg.ticksPerCandle,
  };
}

function createSimulationState(scenarioId) {
  const scenario = loadScenario(scenarioId);
  if (!scenario) {
    throw new Error("No scenario found. Expected JSON under /scenarios.");
  }

  const simCfg = {
    tickMs: Number(scenario.tickMs || 500),
    ticksPerCandle: Number(scenario.ticksPerCandle || 10),
    maxCandles: Number(scenario.maxCandles || 80),
    meanReversion: Number(scenario.meanReversion || 0.12),
    baseNoise: Number(scenario.baseNoise || 0.0018),
  };

  const factors = Object.entries(scenario.factors || {}).reduce((acc, [name, cfg]) => {
    acc[name] = { level: 0, vol: Number(cfg.vol || 0.001), decay: Number(cfg.decay || 0.95) };
    return acc;
  }, {});

  const durationSeconds = Number(scenario.duration_seconds || scenario.durationSeconds || 0);
  const durationTicks = durationSeconds > 0 ? Math.ceil((durationSeconds * 1000) / simCfg.tickMs) : 0;

  return {
    scenario,
    simCfg,
    factors,
    assets: (scenario.assets || []).map((asset) => createAssetState(asset, simCfg)),
    news: [...(scenario.news || [])].sort((a, b) => Number(a.tick || 0) - Number(b.tick || 0)),
    newsCursor: 0,
    tick: 0,
    phase: "running",
    eventCode: null,
    tickTimer: null,
    durationTicks,
  };
}

let sim = createSimulationState(fallbackScenarioId);
const players = new Map();
const adminSockets = new Set();

function resetSimulation(scenarioId) {
  sim = createSimulationState(scenarioId);
  startTicking();
}

function activateScenario(scenarioId) {
  const requested = String(scenarioId || "").trim();
  if (!requested || requested === sim.scenario?.id) return { ok: true };
  const exists = loadScenarioExact(requested);
  if (!exists) return { ok: false, reason: "not-found" };
  if (players.size > 0) return { ok: false, reason: "locked" };
  resetSimulation(requested);
  return { ok: true };
}

function ensurePosition(player, assetId) {
  if (!player.positions[assetId]) {
    player.positions[assetId] = { position: 0, avgCost: 0, realizedPnl: 0 };
  }
  return player.positions[assetId];
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
    pnl: computePositionPnl(data, sim.assets.find((asset) => asset.id === assetId)?.price ?? 0),
  }));
  const socket = io.sockets.sockets.get(player.id);
  if (socket) {
    socket.emit("portfolio", { positions, cash: player.cash });
    socket.emit("openOrders", { orders: player.orders });
  }
}

function applyFillToPosition(positionData, qtySigned, price) {
  const { position, avgCost } = positionData;
  const nextPos = position + qtySigned;

  if (position === 0 || Math.sign(position) === Math.sign(qtySigned)) {
    positionData.position = nextPos;
    positionData.avgCost = nextPos === 0 ? 0 : (position * avgCost + qtySigned * price) / nextPos;
    return 0;
  }

  const closingQty = Math.min(Math.abs(position), Math.abs(qtySigned));
  const realizedDelta = (price - avgCost) * closingQty * Math.sign(position);
  positionData.realizedPnl = (positionData.realizedPnl || 0) + realizedDelta;

  if (nextPos === 0) {
    positionData.position = 0;
    positionData.avgCost = 0;
  } else if (Math.sign(nextPos) === Math.sign(position)) {
    positionData.position = nextPos;
  } else {
    positionData.position = nextPos;
    positionData.avgCost = price;
  }

  return realizedDelta;
}

function fillOrder(player, order, asset) {
  const positionData = ensurePosition(player, order.assetId);
  const qtySigned = order.side === "buy" ? order.qty : -order.qty;
  const previousPosition = positionData.position;
  const realizedPnlDelta = applyFillToPosition(positionData, qtySigned, order.price);
  const tradedNotional = Math.abs(order.qty) * order.price;

  if (order.side === "buy") {
    player.cash -= tradedNotional;
  } else {
    player.cash += tradedNotional;
  }

  const socket = io.sockets.sockets.get(player.id);
  if (socket) {
    socket.emit("execution", {
      assetId: order.assetId,
      side: order.side,
      qty: order.qty,
      price: order.price,
      previousPosition,
      newPosition: positionData.position,
      realizedPnlDelta,
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
  for (const player of players.values()) {
    const filledOrderIds = new Set();
    for (const order of player.orders) {
      if (order.assetId !== asset.id || order.type !== "limit") continue;
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

function applyNewsIfAny() {
  while (sim.newsCursor < sim.news.length) {
    const nextNews = sim.news[sim.newsCursor];
    if (Number(nextNews.tick) > sim.tick) break;
    sim.newsCursor += 1;

    const factorShocks = nextNews.factorShocks || {};
    for (const [factorName, shock] of Object.entries(factorShocks)) {
      if (!sim.factors[factorName]) continue;
      sim.factors[factorName].level += Number(shock || 0);
    }

    const assetShocks = nextNews.assetShocks || {};
    for (const [assetId, pctShock] of Object.entries(assetShocks)) {
      const asset = sim.assets.find((candidate) => candidate.id === assetId);
      if (!asset) continue;
      const scalar = 1 + Number(pctShock || 0);
      asset.fairValue = quantize(Math.max(0.01, asset.fairValue * scalar), asset.decimals);
      asset.price = quantize(Math.max(0.01, asset.price * scalar), asset.decimals);
    }

    io.emit("news", {
      tick: sim.tick,
      headline: nextNews.headline,
      factorShocks,
      assetShocks,
      scenarioId: sim.scenario?.id || null,
    });
  }
}

function evolveFactors() {
  const commonRisk = (Math.random() - 0.5) * sim.simCfg.baseNoise;
  for (const [name, factor] of Object.entries(sim.factors)) {
    const drift = -factor.level * (1 - factor.decay);
    const idio = (Math.random() - 0.5) * factor.vol;
    const commonWeight = name === "globalRisk" ? 0.9 : 0.4;
    factor.level += drift + idio + commonRisk * commonWeight;
  }
}

function computeFairValue(asset) {
  const factorContribution = Object.entries(asset.factors || {}).reduce((acc, [factorName, beta]) => {
    const level = sim.factors[factorName]?.level || 0;
    return acc + Number(beta) * level;
  }, 0);
  const target = asset.basePrice * (1 + factorContribution);
  return Math.max(0.01, quantize(target, asset.decimals));
}

function stepTick() {
  if (sim.phase !== "running") return;
  sim.tick += 1;
  evolveFactors();
  applyNewsIfAny();

  const updates = [];
  const adminUpdates = [];

  for (const asset of sim.assets) {
    asset.fairValue = computeFairValue(asset);

    const meanReversionTerm = sim.simCfg.meanReversion * ((asset.fairValue - asset.price) / Math.max(asset.price, 0.01));
    const idioNoise = (Math.random() - 0.5) * sim.simCfg.baseNoise * 1.7;
    const nextReturn = meanReversionTerm + idioNoise;
    asset.price = quantize(Math.max(0.01, asset.price * (1 + nextReturn)), asset.decimals);

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

    let completedCandle = null;
    if (asset.ticksInCandle >= sim.simCfg.ticksPerCandle) {
      completedCandle = asset.currentCandle;
      asset.candles.push(completedCandle);
      if (asset.candles.length > sim.simCfg.maxCandles) {
        asset.candles.shift();
      }
      asset.nextCandleTime += sim.simCfg.ticksPerCandle;
      asset.currentCandle = null;
      asset.ticksInCandle = 0;
    }

    processLimitOrdersForAsset(asset);

    const shared = {
      id: asset.id,
      symbol: asset.symbol,
      name: asset.name,
      category: asset.category,
      group: asset.group,
      isYield: asset.isYield,
      price: asset.price,
      candle: asset.currentCandle,
      completedCandle,
      lastTrade: asset.lastTrade || null,
    };

    updates.push(shared);
    adminUpdates.push({ ...shared, fairValue: asset.fairValue });
  }

  io.emit("assetTick", { assets: updates, tick: sim.tick });

  if (sim.durationTicks > 0 && sim.tick >= sim.durationTicks) {
    setPhase("ended");
  }

  for (const socketId of adminSockets) {
    const socket = io.sockets.sockets.get(socketId);
    socket?.emit("adminAssetTick", { assets: adminUpdates, tick: sim.tick, scenario: sim.scenario });
  }
}

function startTicking() {
  if (sim.tickTimer) clearInterval(sim.tickTimer);
  sim.tickTimer = setInterval(stepTick, sim.simCfg.tickMs);
}

function setPhase(nextPhase) {
  sim.phase = nextPhase;
  io.emit("phase", nextPhase);
}

function initialAssetPayload() {
  return sim.assets.map((asset) => ({
    id: asset.id,
    symbol: asset.symbol,
    name: asset.name,
    category: asset.category,
    group: asset.group,
    isYield: asset.isYield,
    price: asset.price,
    candles: asset.candles,
    candle: asset.currentCandle,
  }));
}

function initialAdminAssetPayload() {
  const base = initialAssetPayload();
  return base.map((item) => ({
    ...item,
    fairValue: sim.assets.find((asset) => asset.id === item.id)?.fairValue ?? item.price,
  }));
}


app.get("/meta/scenarios", (_req, res) => {
  res.json(listScenarios());
});

app.get("/api/events/:code/players", (req, res) => {
  const eventCode = req.params.code;
  const rows = [...players.values()]
    .filter((player) => !eventCode || player.eventCode === eventCode)
    .map((player) => ({
      runId: player.runId,
      name: player.name,
      joinedAt: player.joinedAt,
      status: player.status,
      latestScore: player.latestScore,
    }));
  res.json({ players: rows });
});

app.get("/api/events/:code/status", (req, res) => {
  const code = req.params.code;
  res.json({ eventCode: code, phase: sim.phase });
});

app.post("/api/admin/phase", (req, res) => {
  const { phase } = req.body || {};
  if (!["running", "paused", "ended"].includes(phase)) {
    res.status(400).json({ ok: false, message: "Invalid phase." });
    return;
  }
  setPhase(phase);
  res.json({ ok: true, phase });
});

io.on("connection", (socket) => {
  const role = socket.handshake.query?.role;
  const requestedScenarioId = String(socket.handshake.query?.scenario_id || "").trim();
  const scenarioActivation = activateScenario(requestedScenarioId);

  if (!scenarioActivation.ok) {
    socket.emit("scenarioError", {
      message: scenarioActivation.reason === "not-found" ? "Scenario not found. Launch from Mint." : "Scenario is already locked for this event.",
    });
  }

  if (role === "admin") {
    adminSockets.add(socket.id);
    socket.emit("phase", sim.phase);
    socket.emit("adminAssetSnapshot", { assets: initialAdminAssetPayload(), tickMs: sim.simCfg.tickMs, scenario: sim.scenario });
  } else {
    socket.emit("phase", sim.phase);
    socket.emit("assetSnapshot", { assets: initialAssetPayload(), tickMs: sim.simCfg.tickMs, scenario: sim.scenario });
  }

  socket.on("join", (payload, ack) => {
    const nameInput = typeof payload === "string" ? payload : payload?.name;
    const nm = String(nameInput || "Player").trim() || "Player";
    const runId = String(payload?.runId || `socket-${socket.id}`);
    const eventCode = payload?.eventCode ? String(payload.eventCode) : null;

    if (eventCode && !sim.eventCode) {
      sim.eventCode = eventCode;
    }

    players.set(socket.id, {
      id: socket.id,
      runId,
      eventCode,
      name: nm,
      positions: {},
      orders: [],
      cash: DEFAULT_CASH,
      joinedAt: new Date().toISOString(),
      status: "active",
      latestScore: null,
    });

    ack?.({ ok: true, phase: sim.phase, assets: initialAssetPayload(), tickMs: sim.simCfg.tickMs, scenario: sim.scenario });
    publishPortfolio(players.get(socket.id));
  });

  socket.on("submitOrder", (order, ack) => {
    const player = players.get(socket.id);
    if (!player) {
      ack?.({ ok: false, reason: "not-joined" });
      return;
    }
    if (sim.phase !== "running") {
      ack?.({ ok: false, reason: "market-paused" });
      return;
    }

    const asset = sim.assets.find((item) => item.id === order?.assetId);
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

    if (type === "market") {
      if (side === "buy" && qty * asset.price > player.cash) {
        ack?.({ ok: false, reason: "insufficient-cash" });
        return;
      }
      fillOrder(player, { assetId: asset.id, side, qty, price: asset.price }, asset);
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
      price: quantize(limitPrice, asset.decimals),
      type,
      t: Date.now(),
    };

    player.orders.push(orderData);
    publishPortfolio(player);
    ack?.({ ok: true, filled: false });
  });


  socket.on("adminPhaseSync", (payload) => {
    if (!adminSockets.has(socket.id)) return;
    const phase = String(payload?.phase || "").toLowerCase();
    if (!["running", "paused", "ended"].includes(phase)) return;
    setPhase(phase);
  });

  socket.on("disconnect", () => {
    adminSockets.delete(socket.id);
    players.delete(socket.id);
  });
});

startTicking();

server.listen(PORT, () => {
  console.log(`Server running on ${PORT}. Scenario: ${sim.scenario.id || "unknown"}`);
});
