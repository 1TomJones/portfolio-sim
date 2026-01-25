import { StrategyBot } from "./base.js";
import { clamp } from "../engine/utils.js";

function roundToTick(price, tick) {
  if (!Number.isFinite(price)) return price;
  if (!Number.isFinite(tick) || tick <= 0) return price;
  return Math.round(price / tick) * tick;
}

function smoothStep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function interpolateCurve(x, x0, x1, y0, y1) {
  if (!Number.isFinite(x) || !Number.isFinite(x0) || !Number.isFinite(x1) || x1 === x0) return y0;
  const t = (x - x0) / (x1 - x0);
  const eased = smoothStep(t);
  return y0 + (y1 - y0) * eased;
}

class SingleRandomBot extends StrategyBot {
  constructor(opts) {
    super({ ...opts, type: "Single-Random" });
    this.randomState = {
      buyProbability: Number.isFinite(this.config?.buyProbability) ? this.config.buyProbability : 0.5,
      sellProbability: Number.isFinite(this.config?.buyProbability) ? 1 - this.config.buyProbability : 0.5,
      aggressiveProbability: Number.isFinite(this.config?.aggressiveProbability)
        ? this.config.aggressiveProbability
        : 0.8,
      fairValueLink: this.config?.fairValueLink === true,
      deviationPct: 0,
      updatedAt: 0,
    };
    this.randomStateTick = 0;
  }

  tick(context) {
    this.updateRandomState(context);
    super.tick(context);
  }

  getTelemetry() {
    return { ...super.getTelemetry(), randomState: this.randomState };
  }

  updateRandomState(context) {
    this.randomStateTick += 1;
    if (this.randomState?.updatedAt && this.randomStateTick % 4 !== 0) return;
    const config = this.config ?? {};
    const fairValueLink = config.fairValueLink === true;
    const baseBuyProbability = Number.isFinite(config.buyProbability) ? config.buyProbability : 0.5;
    const baseAggressiveProbability = Number.isFinite(config.aggressiveProbability)
      ? config.aggressiveProbability
      : 0.8;
    let buyProbability = baseBuyProbability;
    let aggressiveProbability = baseAggressiveProbability;
    let deviationPct = 0;
    if (fairValueLink) {
      const price = Number.isFinite(context?.price)
        ? context.price
        : Number.isFinite(context?.snapshot?.price)
        ? context.snapshot.price
        : this.market?.currentPrice;
      const fairValue = Number.isFinite(context?.fairValue)
        ? context.fairValue
        : Number.isFinite(context?.snapshot?.fairValue)
        ? context.snapshot.fairValue
        : this.market?.fairValue;
      if (Number.isFinite(price) && Number.isFinite(fairValue) && Math.abs(fairValue) > 1e-9) {
        deviationPct = (price - fairValue) / fairValue;
        const absDeviation = Math.abs(deviationPct);
        let aboveBuyProbability = 0.5;
        if (absDeviation <= 0.05) {
          aboveBuyProbability = 0.5;
        } else if (absDeviation <= 0.1) {
          aboveBuyProbability = interpolateCurve(absDeviation, 0.05, 0.1, 0.5, 0.45);
        } else if (absDeviation <= 0.2) {
          aboveBuyProbability = interpolateCurve(absDeviation, 0.1, 0.2, 0.45, 0.3);
        } else if (absDeviation <= 0.25) {
          aboveBuyProbability = interpolateCurve(absDeviation, 0.2, 0.25, 0.3, 0.1);
        } else {
          aboveBuyProbability = 0;
        }
        if (absDeviation > 0.25) {
          buyProbability = deviationPct > 0 ? 0 : 1;
        } else if (deviationPct > 0) {
          buyProbability = aboveBuyProbability;
        } else if (deviationPct < 0) {
          buyProbability = 1 - aboveBuyProbability;
        } else {
          buyProbability = 0.5;
        }
        if (absDeviation >= 0.2) {
          aggressiveProbability = 1;
        }
      }
    }
    buyProbability = clamp(buyProbability, 0, 1);
    aggressiveProbability = clamp(aggressiveProbability, 0, 1);
    this.randomState = {
      buyProbability,
      sellProbability: 1 - buyProbability,
      aggressiveProbability,
      fairValueLink,
      deviationPct,
      updatedAt: Date.now(),
    };
  }

  decide(context) {
    const player = this.ensureSeat();
    if (!player) return null;

    const topOfBook = context?.topOfBook ?? {};
    const bookBids = Array.isArray(topOfBook?.bids) ? topOfBook.bids : [];
    const bookAsks = Array.isArray(topOfBook?.asks) ? topOfBook.asks : [];
    const bestBid = Number.isFinite(topOfBook?.bestBid)
      ? topOfBook.bestBid
      : Number.isFinite(context?.bestBid)
      ? context.bestBid
      : Number.isFinite(context?.snapshot?.bestBid)
      ? context.snapshot.bestBid
      : null;
    const bestAsk = Number.isFinite(topOfBook?.bestAsk)
      ? topOfBook.bestAsk
      : Number.isFinite(context?.bestAsk)
      ? context.bestAsk
      : Number.isFinite(context?.snapshot?.bestAsk)
      ? context.snapshot.bestAsk
      : null;

    const config = this.config ?? {};
    const activeState = this.randomState ?? {};
    const buyProbability = Number.isFinite(activeState.buyProbability)
      ? activeState.buyProbability
      : Number.isFinite(config.buyProbability)
      ? config.buyProbability
      : 0.5;
    const aggressiveProbability = Number.isFinite(activeState.aggressiveProbability)
      ? activeState.aggressiveProbability
      : Number.isFinite(config.aggressiveProbability)
      ? config.aggressiveProbability
      : 0.8;
    const currentPrice = Number.isFinite(context.price)
      ? context.price
      : Number.isFinite(context.snapshot?.price)
      ? context.snapshot.price
      : this.market?.currentPrice;
    if (!Number.isFinite(currentPrice)) {
      this.setRegime("awaiting-price");
      return { skipped: true, reason: "no-current-price" };
    }

    const tick = Number.isFinite(context.tickSize) ? context.tickSize : 0.25;
    const roundedLast = roundToTick(currentPrice, tick);
    const pickOffsetTicks = () => 1 + Math.floor(Math.random() * 4);

    const side = Math.random() < buyProbability ? "BUY" : "SELL";
    const isAggressive = Math.random() < aggressiveProbability;
    const quantity = this.sampleSize();
    let action = "limit";
    let price = null;
    let mode = isAggressive ? "aggressive" : "passive";
    const offset = pickOffsetTicks();

    if (side === "BUY") {
      const frontBuy = Number.isFinite(bestBid)
        ? bestBid
        : Number.isFinite(bookBids[0]?.price)
        ? bookBids[0].price
        : roundedLast;
      if (isAggressive) {
        price = roundToTick(frontBuy + offset * tick, tick);
        action = "aggressive-limit";
      } else {
        price = roundToTick(frontBuy - offset * tick, tick);
        action = "passive-limit";
      }
    } else {
      const frontSell = Number.isFinite(bestAsk)
        ? bestAsk
        : Number.isFinite(bookAsks[0]?.price)
        ? bookAsks[0].price
        : roundedLast;
      if (isAggressive) {
        price = roundToTick(frontSell - offset * tick, tick);
        action = "aggressive-limit";
      } else {
        price = roundToTick(frontSell + offset * tick, tick);
        action = "passive-limit";
      }
    }

    if (!Number.isFinite(price)) {
      this.setRegime("awaiting-price");
      return { skipped: true, reason: "invalid-price" };
    }

    this.submitOrder({ type: "limit", side, price, quantity, source: "random" });
    this.setRegime("single-random");
    return {
      regime: this.currentRegime,
      buyProbability,
      aggressiveProbability,
      side,
      mode,
      price,
      action,
    };
  }
}

class LiquidityLadderBot extends StrategyBot {
  constructor(opts) {
    super({ ...opts, type: "Liquidity-Ladder-MM" });
    this.activeOrderIds = new Set();
    this.activeOrderTargets = new Map();
    this.lastMidUsed = null;
    this.lastRefreshAt = 0;
  }

  cancelActiveOrders() {
    for (const id of this.activeOrderIds) {
      this.cancelOrder(id);
    }
    this.activeOrderIds.clear();
    this.activeOrderTargets.clear();
  }

  shouldRefresh(midPrice, tick, now) {
    const config = this.config ?? {};
    const refreshTicks = Number.isFinite(config.refreshTicks) ? config.refreshTicks : 2;
    const refreshMs = Number.isFinite(config.refreshMs) ? config.refreshMs : 1000;
    if (!Number.isFinite(this.lastMidUsed)) return true;
    if (Number.isFinite(midPrice) && Math.abs(midPrice - this.lastMidUsed) >= refreshTicks * tick) return true;
    if (Number.isFinite(refreshMs) && now - this.lastRefreshAt >= refreshMs) return true;
    for (const [orderId, targetSize] of this.activeOrderTargets.entries()) {
      const info = this.restingOrders.get(orderId);
      if (!info) return true;
      const remaining = Number.isFinite(info.remaining) ? info.remaining : this.normalizeRemaining(info.order);
      if (remaining < Math.max(1, targetSize * 0.8)) return true;
    }
    return false;
  }

  depthIsSufficient(midPrice, tick) {
    const config = this.config ?? {};
    const minDepth = config.minDepth ?? null;
    if (!minDepth || !Number.isFinite(minDepth.ticks) || !Number.isFinite(minDepth.size)) return false;
    const depthTicks = Math.max(1, Math.round(minDepth.ticks));
    const depthSize = Math.max(1, minDepth.size);
    const topOfBook = this.lastContext?.topOfBook ?? {};
    const bids = Array.isArray(topOfBook?.bids) ? topOfBook.bids : [];
    const asks = Array.isArray(topOfBook?.asks) ? topOfBook.asks : [];
    const minBidPrice = midPrice - depthTicks * tick;
    const maxAskPrice = midPrice + depthTicks * tick;
    const bidDepth = bids
      .filter((lvl) => Number.isFinite(lvl.price) && lvl.price >= minBidPrice)
      .reduce((sum, lvl) => sum + (Number(lvl.size) || 0), 0);
    const askDepth = asks
      .filter((lvl) => Number.isFinite(lvl.price) && lvl.price <= maxAskPrice)
      .reduce((sum, lvl) => sum + (Number(lvl.size) || 0), 0);
    return bidDepth >= depthSize && askDepth >= depthSize;
  }

  placeLadder(midPrice, tick) {
    const config = this.config ?? {};
    const baseDistance = Number.isFinite(config.baseDistanceTicks) ? config.baseDistanceTicks : 10;
    const stepTicks = Number.isFinite(config.stepTicks) ? config.stepTicks : 2;
    const minDistanceTicks = Number.isFinite(config.minDistanceTicks) ? config.minDistanceTicks : null;
    const maxDistanceTicks = Number.isFinite(config.maxDistanceTicks) ? config.maxDistanceTicks : null;
    const levels = Number.isFinite(config.levels) ? Math.max(1, Math.round(config.levels)) : 8;
    const sizeLadder = (
      Array.isArray(config.sizes)
        ? config.sizes.map((val) => Math.max(1, Math.round(val)))
        : [5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28]
    ).sort((a, b) => a - b);
    const sizeAt = (i) => sizeLadder[i] ?? sizeLadder[sizeLadder.length - 1] ?? 1;
    const useRange =
      Number.isFinite(minDistanceTicks) &&
      Number.isFinite(maxDistanceTicks) &&
      levels > 1;

    this.activeOrderIds.clear();
    this.activeOrderTargets.clear();

    for (let i = 0; i < levels; i += 1) {
      const dist = useRange
        ? minDistanceTicks + (i * (maxDistanceTicks - minDistanceTicks)) / (levels - 1)
        : baseDistance + (i + 1) * stepTicks;
      const bidPrice = roundToTick(midPrice - dist * tick, tick);
      const askPrice = roundToTick(midPrice + dist * tick, tick);
      const size = sizeAt(i);
      if (Number.isFinite(bidPrice) && bidPrice > 0) {
        const result = this.submitOrder({ type: "limit", side: "BUY", price: bidPrice, quantity: size, source: "mm" });
        if (result?.resting?.id) {
          this.activeOrderIds.add(result.resting.id);
          this.activeOrderTargets.set(result.resting.id, size);
        }
      }
      if (Number.isFinite(askPrice) && askPrice > 0) {
        const result = this.submitOrder({ type: "limit", side: "SELL", price: askPrice, quantity: size, source: "mm" });
        if (result?.resting?.id) {
          this.activeOrderIds.add(result.resting.id);
          this.activeOrderTargets.set(result.resting.id, size);
        }
      }
    }
  }

  decide(context) {
    this.lastContext = context;
    const player = this.ensureSeat();
    if (!player) return null;

    const topOfBook = context?.topOfBook ?? {};
    const bestBid = Number.isFinite(topOfBook?.bestBid)
      ? topOfBook.bestBid
      : Number.isFinite(context?.bestBid)
      ? context.bestBid
      : Number.isFinite(context?.snapshot?.bestBid)
      ? context.snapshot.bestBid
      : null;
    const bestAsk = Number.isFinite(topOfBook?.bestAsk)
      ? topOfBook.bestAsk
      : Number.isFinite(context?.bestAsk)
      ? context.bestAsk
      : Number.isFinite(context?.snapshot?.bestAsk)
      ? context.snapshot.bestAsk
      : null;
    const tick = Number.isFinite(context.tickSize) ? context.tickSize : 0.25;
    const lastPrice = Number.isFinite(context.price)
      ? context.price
      : Number.isFinite(context.snapshot?.price)
      ? context.snapshot.price
      : this.market?.currentPrice;

    const midPrice = Number.isFinite(bestBid) && Number.isFinite(bestAsk)
      ? (bestBid + bestAsk) / 2
      : Number.isFinite(topOfBook?.midPrice)
      ? topOfBook.midPrice
      : lastPrice;

    if (!Number.isFinite(midPrice)) {
      this.setRegime("awaiting-price");
      return { skipped: true, reason: "no-mid" };
    }

    if (this.depthIsSufficient(midPrice, tick)) {
      this.setRegime("idle");
      return { skipped: true, reason: "depth-ok" };
    }

    const now = context?.now ?? Date.now();
    if (!this.shouldRefresh(midPrice, tick, now)) {
      this.setRegime("steady");
      return { skipped: true, reason: "ladder-fresh" };
    }

    this.cancelActiveOrders();
    this.placeLadder(midPrice, tick);
    this.lastMidUsed = midPrice;
    this.lastRefreshAt = now;
    this.setRegime("ladder-refresh");
    return {
      regime: this.currentRegime,
      midPrice,
      ordersPlaced: this.activeOrderIds.size,
    };
  }
}

const BOT_BUILDERS = {
  "Single-Random": SingleRandomBot,
  "Liquidity-Ladder-MM": LiquidityLadderBot,
};

export function createBotFromConfig(config, deps) {
  const Ctor = BOT_BUILDERS[config?.botType];
  if (!Ctor) {
    throw new Error(`Unknown bot type: ${config?.botType}`);
  }
  return new Ctor({ ...deps, id: config.id, name: config.name, config });
}
