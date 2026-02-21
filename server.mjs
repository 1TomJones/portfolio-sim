import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

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
app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

app.get("/app-config.js", (_req, res) => {
  const config = {
    NODE_ENV: process.env.NODE_ENV || "development",
  };
  res.type("application/javascript");
  res.send(`window.APP_CONFIG = ${JSON.stringify(config)};`);
});

const PORT = process.env.PORT || 10000;
const DEFAULT_CASH = 10000000;
const scenariosPath = path.join(__dirname, "scenarios");
const metadataPath = path.join(__dirname, "public", "meta", "scenarios.json");
const fallbackScenarioId = process.env.DEFAULT_SCENARIO_ID || "default";

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
    .map((name) => {
      const scenario = safeJsonRead(path.join(scenariosPath, name));
      const id = path.basename(name, ".json");
      return {
        id,
        scenario_id: id,
        name: scenario?.name || id || "Unnamed scenario",
        duration_seconds: Number(scenario?.duration_seconds || scenario?.durationSeconds || 0),
        description: scenario?.description || "",
        version: scenario?.version || "1.0.0",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getScenarioMetadata() {
  const fromFile = safeJsonRead(metadataPath);
  if (Array.isArray(fromFile) && fromFile.length) {
    return fromFile.map((scenario) => ({
      ...scenario,
      scenario_id: scenario.scenario_id || scenario.id,
      duration_minutes:
        Number(scenario.duration_minutes) ||
        (Number.isFinite(Number(scenario.duration_seconds)) ? Number(scenario.duration_seconds) / 60 : undefined),
    }));
  }

  return listScenarios().map((scenario) => ({
    id: scenario.id,
    scenario_id: scenario.id,
    name: scenario.name,
    description: scenario.description,
    duration_seconds: scenario.duration_seconds,
    duration_minutes: scenario.duration_seconds ? scenario.duration_seconds / 60 : undefined,
    version: scenario.version,
  }));
}

function quantize(value, decimals = 2) {
  const p = 10 ** decimals;
  return Math.round(value * p) / p;
}

function pricePointSize(startPrice) {
  const price = Number(startPrice || 0);
  if (price < 100) return 0.05;
  if (price < 200) return 0.1;
  if (price < 500) return 0.25;
  if (price < 1000) return 0.5;
  if (price < 2000) return 1;
  if (price < 5000) return 2.5;
  if (price < 10000) return 5;
  return 10;
}

function distanceTowardProbability(distanceAbsPct) {
  if (distanceAbsPct <= 0.02) return 0.5;
  if (distanceAbsPct <= 0.04) return 0.55;
  if (distanceAbsPct <= 0.06) return 0.6;
  if (distanceAbsPct <= 0.08) return 0.7;
  if (distanceAbsPct <= 0.1) return 0.8;
  return 0.9;
}

function resolveSimStartTimestampMs(scenario) {
  const parsed = Date.parse(scenario?.simStart);
  if (Number.isFinite(parsed)) return parsed;
  return Date.now();
}

function candleStepSeconds(simCfgOrTicksPerCandle, maybeGameMsPerTick) {
  if (typeof simCfgOrTicksPerCandle === "object") {
    return Math.max(1, Math.round((simCfgOrTicksPerCandle.ticksPerCandle * simCfgOrTicksPerCandle.gameMsPerTick) / 1000));
  }
  return Math.max(1, Math.round((simCfgOrTicksPerCandle * maybeGameMsPerTick) / 1000));
}

function buildInitialCandles(startPrice, decimals, maxCandles, ticksPerCandle, gameMsPerTick, simStartMs) {
  const candles = [];
  let price = startPrice;
  const stepSeconds = candleStepSeconds(ticksPerCandle, gameMsPerTick);
  const startTime = Math.floor((simStartMs - maxCandles * ticksPerCandle * gameMsPerTick) / 1000);
  for (let i = 0; i < maxCandles; i += 1) {
    const time = startTime + i * stepSeconds;
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
  const pointSize = pricePointSize(assetDef.startPrice);
  const pointSizeDecimals = String(pointSize).includes(".") ? String(pointSize).split(".")[1].length : 0;
  const displayDecimals = Math.max(decimals, pointSizeDecimals);
  const initial = buildInitialCandles(
    assetDef.startPrice,
    displayDecimals,
    simCfg.maxCandles,
    simCfg.ticksPerCandle,
    simCfg.gameMsPerTick,
    simCfg.simStartMs,
  );
  const lastCandleTime = initial.candles[initial.candles.length - 1]?.time ?? Math.floor(simCfg.simStartMs / 1000);
  const stepSeconds = candleStepSeconds(simCfg);

  return {
    id: assetDef.id,
    symbol: assetDef.symbol,
    name: assetDef.name,
    category: assetDef.category,
    group: assetDef.group || null,
    isYield: Boolean(assetDef.isYield),
    decimals: displayDecimals,
    pointSize,
    basePrice: assetDef.startPrice,
    factors: assetDef.factors || {},
    correlations: assetDef.correlations || {},
    price: quantize(initial.price, displayDecimals),
    fairValue: quantize(assetDef.startPrice, displayDecimals),
    candles: initial.candles,
    currentCandle: {
      time: lastCandleTime + stepSeconds,
      open: initial.price,
      high: initial.price,
      low: initial.price,
      close: initial.price,
    },
    ticksInCandle: 0,
    nextCandleTime: lastCandleTime + stepSeconds,
  };
}

function createSimulationState(scenarioId) {
  const scenario = loadScenario(scenarioId);
  if (!scenario) {
    throw new Error("No scenario found. Expected JSON under /scenarios.");
  }

  const simCfg = {
    tickMs: Number(scenario.tickMs || 100),
    gameMsPerTick: 12 * 60 * 1000,
    ticksPerCandle: Number(scenario.ticksPerCandle || 60),
    maxCandles: Number(scenario.maxCandles || 80),
    meanReversion: Number(scenario.meanReversion || 0.12),
    baseNoise: Number(scenario.baseNoise || 0.0018),
  };
  simCfg.simStartMs = resolveSimStartTimestampMs(scenario);

  const factors = Object.entries(scenario.factors || {}).reduce((acc, [name, cfg]) => {
    acc[name] = { level: 0, vol: Number(cfg.vol || 0.001), decay: Number(cfg.decay || 0.95) };
    return acc;
  }, {});

  const durationSeconds = Number(scenario.duration_seconds || scenario.durationSeconds || 0);
  const durationTicks = durationSeconds > 0 ? Math.ceil((durationSeconds * 1000) / simCfg.tickMs) : 21600;

  const correlationRules = [
    ...(Array.isArray(scenario.correlations) ? scenario.correlations : []),
    ...(Array.isArray(scenario.crossAssetRules) ? scenario.crossAssetRules : []),
  ]
    .map((rule) => ({
      sourceAssetId: String(rule.sourceAssetId || rule.source || ""),
      targetAssetId: String(rule.targetAssetId || rule.target || ""),
      beta: Number(rule.beta || rule.weight || 0),
    }))
    .filter((rule) => rule.sourceAssetId && rule.targetAssetId && Number.isFinite(rule.beta));

  return {
    scenario,
    simCfg,
    factors,
    assets: (scenario.assets || []).map((asset) => createAssetState(asset, simCfg)),
    news: [...(scenario.news || [])].sort((a, b) => Number(a.tick || 0) - Number(b.tick || 0)),
    newsCursor: 0,
    macroEvents: [...(scenario.macroEvents || [])]
      .map((event) => ({
        ...event,
        expectationTick: Number(event.expectationTick || 0),
        actualTick: Number(event.actualTick || 0),
      }))
      .sort((a, b) => Number(a.expectationTick || 0) - Number(b.expectationTick || 0)),
    macroExpectationCursor: 0,
    releasedMacro: [],
    assetImpacts: {},
    correlationRules,
    tick: 0,
    phase: "lobby",
    eventCode: null,
    tickTimer: null,
    durationTicks,
    simStartMs: simCfg.simStartMs,
  };
}

function currentGameTimestampMs() {
  return sim.simStartMs + sim.tick * sim.simCfg.gameMsPerTick;
}

function macroPayload() {
  return {
    events: sim.releasedMacro,
    upcoming: sim.macroEvents.filter((event) => event.actualTick >= sim.tick).map((event) => ({
      id: event.id,
      label: event.label,
      expectationTick: event.expectationTick,
      actualTick: event.actualTick,
      expected: event.expected,
      actual: event.actual,
      status: sim.tick >= event.actualTick ? "actual" : sim.tick >= event.expectationTick ? "expected" : "upcoming",
    })),
    tick: sim.tick,
    gameTimeMs: currentGameTimestampMs(),
  };
}

function getNewsTick(newsItem) {
  if (Number.isFinite(Number(newsItem?.tick))) return Number(newsItem.tick);
  if (Number.isFinite(Number(newsItem?.timestamp_seconds))) return Math.floor(Number(newsItem.timestamp_seconds));
  if (Number.isFinite(Number(newsItem?.t))) return Math.floor(Number(newsItem.t));
  return 0;
}

function registerAssetImpact(assetId, fvPctDelta, decaySeconds) {
  if (!assetId || !Number.isFinite(Number(fvPctDelta))) return;
  const decayTicks = Math.max(1, Math.round((Number(decaySeconds || 0) * 1000) / sim.simCfg.tickMs) || 1);
  if (!sim.assetImpacts[assetId]) sim.assetImpacts[assetId] = [];
  sim.assetImpacts[assetId].push({
    fvPctDelta: Number(fvPctDelta),
    ticksLeft: decayTicks,
    totalTicks: decayTicks,
  });
}

function currentAssetImpactPct(assetId) {
  const impacts = sim.assetImpacts[assetId] || [];
  return impacts.reduce((acc, impact) => {
    const weight = Math.max(0, impact.ticksLeft) / Math.max(1, impact.totalTicks);
    return acc + impact.fvPctDelta * weight;
  }, 0);
}

function decayAssetImpacts() {
  for (const [assetId, impacts] of Object.entries(sim.assetImpacts)) {
    sim.assetImpacts[assetId] = impacts
      .map((impact) => ({ ...impact, ticksLeft: impact.ticksLeft - 1 }))
      .filter((impact) => impact.ticksLeft > 0);
    if (!sim.assetImpacts[assetId].length) {
      delete sim.assetImpacts[assetId];
    }
  }
}

let sim = createSimulationState(fallbackScenarioId);
const players = new Map();
const adminSockets = new Set();
const loadedScenarios = listScenarios();
console.log(`Loaded ${loadedScenarios.length} scenarios: ${loadedScenarios.map((scenario) => scenario.id).join(", ")}`);

function resetSimulation(scenarioId) {
  sim = createSimulationState(scenarioId);
  io.emit("assetSnapshot", { assets: initialAssetPayload(), tickMs: sim.simCfg.tickMs, simStartMs: sim.simStartMs, tick: sim.tick, durationTicks: sim.durationTicks, scenario: sim.scenario });
  for (const socketId of adminSockets) {
    const socket = io.sockets.sockets.get(socketId);
    socket?.emit("adminAssetSnapshot", { assets: initialAdminAssetPayload(), tickMs: sim.simCfg.tickMs, simStartMs: sim.simStartMs, tick: sim.tick, durationTicks: sim.durationTicks, scenario: sim.scenario });
  }
}

function activateScenario(scenarioId) {
  const requested = String(scenarioId || "").trim();
  if (!requested || requested === sim.scenario?.id) return { ok: true };
  const exists = loadScenarioExact(requested);
  if (!exists) return { ok: false, reason: "not-found" };
  resetSimulation(requested);
  return { ok: true };
}

function rosterPayload() {
  return {
    players: [...players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      runId: player.runId,
      joinedAt: player.joinedAt,
    })),
  };
}

function broadcastRoster() {
  io.emit("roster", rosterPayload());
}

function applyDurationOverride(durationMinutes) {
  const asNumber = Number(durationMinutes);
  if (!Number.isFinite(asNumber) || asNumber <= 0) return;
  const seconds = asNumber * 60;
  sim.durationTicks = Math.ceil((seconds * 1000) / sim.simCfg.tickMs);
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
  const requestedQty = Math.abs(Number(order.qty || 0));
  let effectiveQty = requestedQty;

  if (order.side === "sell") {
    effectiveQty = Math.min(effectiveQty, Math.max(0, Number(positionData.position || 0)));
  }

  if (!Number.isFinite(effectiveQty) || effectiveQty <= 0) {
    return { filledQty: 0, realizedPnlDelta: 0 };
  }

  const qtySigned = order.side === "buy" ? effectiveQty : -effectiveQty;
  const previousPosition = positionData.position;
  const realizedPnlDelta = applyFillToPosition(positionData, qtySigned, order.price);
  const tradedNotional = effectiveQty * order.price;

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
      qty: effectiveQty,
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

  return { filledQty: effectiveQty, realizedPnlDelta };
}

function processLimitOrdersForAsset(asset) {
  for (const player of players.values()) {
    const filledOrderIds = new Set();
    for (const order of player.orders) {
      if (order.assetId !== asset.id || order.type !== "limit") continue;
      if (order.side === "buy" && asset.price <= order.price) {
        const fill = fillOrder(player, order, asset);
        if ((fill?.filledQty || 0) > 0) filledOrderIds.add(order.id);
      } else if (order.side === "sell" && asset.price >= order.price) {
        const fill = fillOrder(player, order, asset);
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
    if (getNewsTick(nextNews) > sim.tick) break;
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
      registerAssetImpact(asset.id, Number(pctShock || 0), Number(nextNews.decay_seconds || 180));
    }

    for (const impact of nextNews.impacts || []) {
      const symbol = String(impact.symbol || "").trim();
      const linkedAsset = sim.assets.find((candidate) => candidate.id === impact.assetId || candidate.symbol === symbol);
      if (!linkedAsset) continue;
      registerAssetImpact(linkedAsset.id, Number(impact.fv_pct_delta || 0), Number(impact.decay_seconds || nextNews.decay_seconds || 180));
    }

    const macroLinked = sim.macroEvents.some((event) => Number(event.actualTick) === Number(sim.tick));

    io.emit("news", {
      tick: sim.tick,
      gameTimeMs: currentGameTimestampMs(),
      headline: nextNews.headline,
      factorShocks,
      assetShocks,
      category: macroLinked ? "macro" : "general",
      scenarioId: sim.scenario?.id || null,
    });
  }
}

function applyMacroEventIfAny() {
  while (sim.macroExpectationCursor < sim.macroEvents.length) {
    const event = sim.macroEvents[sim.macroExpectationCursor];
    if (event.expectationTick > sim.tick) break;

    const released = {
      id: event.id,
      label: event.label,
      expectationTick: event.expectationTick,
      actualTick: event.actualTick,
      expected: event.expected,
      actual: event.actual,
      status: sim.tick >= event.actualTick ? "actual" : "expected",
      tick: sim.tick,
    };

    sim.releasedMacro.unshift(released);
    sim.releasedMacro = sim.releasedMacro.slice(0, 24);
    sim.macroExpectationCursor += 1;
  }

  for (let i = 0; i < sim.releasedMacro.length; i += 1) {
    const event = sim.releasedMacro[i];
    if (event.status === "expected" && sim.tick >= event.actualTick) {
      sim.releasedMacro[i] = { ...event, status: "actual", tick: sim.tick };
    }
  }
}

function evolveFactors() {
  for (const factor of Object.values(sim.factors)) {
    const drift = -factor.level * (1 - factor.decay);
    factor.level += drift;
  }
}

function computeFairValue(asset) {
  const factorContribution = Object.entries(asset.factors || {}).reduce((acc, [factorName, beta]) => {
    const level = sim.factors[factorName]?.level || 0;
    return acc + Number(beta) * level;
  }, 0);
  const impactPct = currentAssetImpactPct(asset.id);
  const correlationContribution = sim.correlationRules.reduce((acc, rule) => {
    if (rule.targetAssetId !== asset.id) return acc;
    const source = sim.assets.find((candidate) => candidate.id === rule.sourceAssetId);
    if (!source || !Number.isFinite(source.price) || !Number.isFinite(source.basePrice) || source.basePrice <= 0) return acc;
    return acc + ((source.price - source.basePrice) / source.basePrice) * rule.beta;
  }, 0);

  const inlineCorrelationContribution = Object.entries(asset.correlations || {}).reduce((acc, [sourceAssetId, beta]) => {
    const source = sim.assets.find((candidate) => candidate.id === sourceAssetId);
    if (!source || !Number.isFinite(source.price) || !Number.isFinite(source.basePrice) || source.basePrice <= 0) return acc;
    return acc + ((source.price - source.basePrice) / source.basePrice) * Number(beta || 0);
  }, 0);

  const target = asset.basePrice * (1 + factorContribution + correlationContribution + inlineCorrelationContribution) * (1 + impactPct);
  return Math.max(0.01, quantize(target, asset.decimals));
}

function moveAssetPriceByPoint(asset) {
  const fv = Math.max(asset.fairValue, 0.01);
  const price = Math.max(asset.price, 0.01);
  const signedDistancePct = (fv - price) / fv;
  const distanceAbsPct = Math.abs(signedDistancePct);
  const towardProb = distanceTowardProbability(distanceAbsPct);
  const moveToward = Math.random() < towardProb;

  let direction = 0;
  if (Math.abs(fv - price) < Number.EPSILON) {
    direction = Math.random() < 0.5 ? 1 : -1;
  } else {
    const towardDirection = fv > price ? 1 : -1;
    direction = moveToward ? towardDirection : -towardDirection;
  }

  return quantize(Math.max(0.01, price + direction * asset.pointSize), asset.decimals);
}

function stepTick() {
  if (sim.phase !== "running") return;
  sim.tick += 1;
  evolveFactors();
  applyMacroEventIfAny();
  applyNewsIfAny();

  const updates = [];
  const adminUpdates = [];

  for (const asset of sim.assets) {
    asset.fairValue = computeFairValue(asset);
    asset.price = moveAssetPriceByPoint(asset);

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
      asset.nextCandleTime += candleStepSeconds(sim.simCfg);
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

  decayAssetImpacts();

  io.emit("assetTick", { assets: updates, tick: sim.tick, durationTicks: sim.durationTicks });
  io.emit("macroEvents", macroPayload());

  if (sim.durationTicks > 0 && sim.tick >= sim.durationTicks) {
    setPhase("ended");
  }

  for (const socketId of adminSockets) {
    const socket = io.sockets.sockets.get(socketId);
    socket?.emit("adminAssetTick", { assets: adminUpdates, tick: sim.tick, durationTicks: sim.durationTicks, scenario: sim.scenario });
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
    simStartMs: sim.simStartMs,
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
  res.json(getScenarioMetadata());
});

app.get("/meta/scenarios.json", (_req, res) => {
  res.json(getScenarioMetadata());
});

function getMetadataPayload(req) {
  const scenarios = getScenarioMetadata();
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  return {
    sim_id: "portfolio_sim",
    scenarios,
    links: {
      player: `${baseUrl}/?event_code={event_code}&scenario_id={scenario_id}`,
      admin: `${baseUrl}/admin.html?event_code={event_code}&scenario_id={scenario_id}`,
    },
  };
}

app.get("/metadata", (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.json(getMetadataPayload(req));
});

app.get("/api/metadata", (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.json(getMetadataPayload(req));
});

app.get("/api/scenarios", (_req, res) => {
  res.json({ scenarios: getScenarioMetadata() });
});

app.post("/api/admin/start", (req, res) => {
  const { scenario_id: scenarioId, duration_minutes: durationMinutes, event_code: eventCode } = req.body || {};
  if (scenarioId) {
    const activation = activateScenario(scenarioId);
    if (!activation.ok) {
      const status = activation.reason === "not-found" ? 404 : 409;
      res.status(status).json({ ok: false, reason: activation.reason });
      return;
    }
  }

  if (eventCode) {
    sim.eventCode = String(eventCode);
  }
  applyDurationOverride(durationMinutes);
  setPhase("running");
  res.json({ ok: true, scenario_id: sim.scenario?.id || null, event_code: sim.eventCode, duration_ticks: sim.durationTicks });
});

app.post("/api/admin/scenario", (req, res) => {
  const { scenario_id: scenarioId } = req.body || {};
  const activation = activateScenario(scenarioId);
  if (!activation.ok) {
    const status = activation.reason === "not-found" ? 404 : 409;
    res.status(status).json({ ok: false, reason: activation.reason });
    return;
  }
  res.json({ ok: true, scenario_id: sim.scenario?.id || null, phase: sim.phase });
});

app.use((req, _res, next) => {
  if (req.method !== "GET") return next();
  if (req.query?.duration_minutes) applyDurationOverride(req.query.duration_minutes);
  if (req.query?.event_code && !sim.eventCode) sim.eventCode = String(req.query.event_code);
  next();
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

  if (role === "admin") {
    adminSockets.add(socket.id);
    socket.emit("phase", sim.phase);
    socket.emit("adminAssetSnapshot", { assets: initialAdminAssetPayload(), tickMs: sim.simCfg.tickMs, simStartMs: sim.simStartMs, tick: sim.tick, durationTicks: sim.durationTicks, scenario: sim.scenario });
    socket.emit("macroEvents", macroPayload());
  } else {
    socket.emit("phase", sim.phase);
    socket.emit("assetSnapshot", { assets: initialAssetPayload(), tickMs: sim.simCfg.tickMs, simStartMs: sim.simStartMs, tick: sim.tick, durationTicks: sim.durationTicks, scenario: sim.scenario });
    socket.emit("macroEvents", macroPayload());
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

    broadcastRoster();
    ack?.({ ok: true, phase: sim.phase, assets: initialAssetPayload(), tickMs: sim.simCfg.tickMs, durationTicks: sim.durationTicks, scenario: sim.scenario, ...rosterPayload() });
    socket.emit("macroEvents", macroPayload());
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
      const owned = Math.max(0, Number(ensurePosition(player, asset.id).position || 0));
      const effectiveQty = side === "sell" ? Math.min(qty, owned) : qty;
      if (side === "sell" && effectiveQty <= 0) {
        ack?.({ ok: true, filled: false, qty: 0 });
        return;
      }
      const fill = fillOrder(player, { assetId: asset.id, side, qty: effectiveQty, price: asset.price }, asset);
      ack?.({ ok: true, filled: (fill?.filledQty || 0) > 0, qty: fill?.filledQty || 0 });
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

    const owned = Math.max(0, Number(ensurePosition(player, asset.id).position || 0));
    const effectiveQty = side === "sell" ? Math.min(qty, owned) : qty;
    if (side === "sell" && effectiveQty <= 0) {
      ack?.({ ok: true, filled: false, qty: 0 });
      return;
    }

    const orderData = {
      id: `order-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      assetId: asset.id,
      side,
      qty: effectiveQty,
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
    broadcastRoster();
  });
});

startTicking();

server.listen(PORT, () => {
  console.log(`Server running on ${PORT}. Scenario: ${sim.scenario.id || "unknown"}`);
});
