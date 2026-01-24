import { StrategyBot } from "./base.js";
import { clamp } from "../engine/utils.js";

function roundToTick(price, tick) {
  if (!Number.isFinite(price)) return price;
  if (!Number.isFinite(tick) || tick <= 0) return price;
  return Math.round(price / tick) * tick;
}

class SingleRandomBot extends StrategyBot {
  constructor(opts) {
    super({ ...opts, type: "Single-Random" });
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
    let buyProbability = Number.isFinite(config.buyProbability) ? config.buyProbability : 0.5;
    const aggressiveProbability = Number.isFinite(config.aggressiveProbability)
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
    const fairValue = Number.isFinite(context.fairValue)
      ? context.fairValue
      : Number.isFinite(context.snapshot?.fairValue)
      ? context.snapshot.fairValue
      : null;
    const midPrice = Number.isFinite(bestBid) && Number.isFinite(bestAsk)
      ? (bestBid + bestAsk) / 2
      : Number.isFinite(topOfBook?.midPrice)
      ? topOfBook.midPrice
      : roundedLast;
    const alpha = Number.isFinite(config.meanReversionAlpha) ? config.meanReversionAlpha : 0;
    if (Number.isFinite(fairValue) && Number.isFinite(midPrice) && alpha > 0) {
      const devTicks = (midPrice - fairValue) / tick;
      buyProbability = clamp(0.5 - devTicks * alpha, 0.1, 0.9);
    }
    const rangeConfig = config.kRange ?? {};
    const rangeMin = Array.isArray(rangeConfig)
      ? rangeConfig[0]
      : Number.isFinite(rangeConfig.min)
      ? rangeConfig.min
      : 0;
    const rangeMax = Array.isArray(rangeConfig)
      ? rangeConfig[1]
      : Number.isFinite(rangeConfig.max)
      ? rangeConfig.max
      : 4;
    const kMin = Math.max(0, Math.min(rangeMin ?? 0, rangeMax ?? 0));
    const kMax = Math.max(0, Math.max(rangeMin ?? 0, rangeMax ?? 0));
    const drawK = () => {
      const span = Math.max(0, Math.floor(kMax) - Math.floor(kMin));
      return Math.floor(kMin) + Math.floor(Math.random() * (span + 1));
    };
    const pickOffsetTicks = () => 1 + Math.floor(Math.random() * 3);
    const improveAtBestProbability = 0.2;

    const side = Math.random() < buyProbability ? "BUY" : "SELL";
    const isAggressive = Math.random() < aggressiveProbability;
    const quantity = this.sampleSize();
    let action = "limit";
    let price = null;
    let k = null;
    let mode = isAggressive ? "aggressive" : "passive";

    if (side === "BUY") {
      const hasSellOrders = bookAsks.length > 0 || Number.isFinite(bestAsk);
      if (isAggressive) {
        if (!hasSellOrders) {
          if (Number.isFinite(bestBid) && Math.random() < improveAtBestProbability) {
            price = roundToTick(bestBid, tick);
          } else if (Number.isFinite(bestBid)) {
            price = roundToTick(bestBid + tick, tick);
          } else {
            price = roundToTick(roundedLast - tick, tick);
          }
          action = "rebuild-book";
        } else {
          k = drawK();
          price = roundToTick(roundedLast + k * tick, tick);
          action = "marketable-limit";
        }
      } else {
        const offset = pickOffsetTicks();
        price = roundToTick(roundedLast - offset * tick, tick);
      }
    } else {
      const hasBuyOrders = bookBids.length > 0 || Number.isFinite(bestBid);
      if (isAggressive) {
        if (!hasBuyOrders) {
          if (Number.isFinite(bestAsk) && Math.random() < improveAtBestProbability) {
            price = roundToTick(bestAsk, tick);
          } else if (Number.isFinite(bestAsk)) {
            price = roundToTick(bestAsk - tick, tick);
          } else {
            price = roundToTick(roundedLast + tick, tick);
          }
          action = "rebuild-book";
        } else {
          k = drawK();
          price = roundToTick(roundedLast - k * tick, tick);
          action = "marketable-limit";
        }
      } else {
        const offset = pickOffsetTicks();
        price = roundToTick(roundedLast + offset * tick, tick);
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
      kRange: { min: kMin, max: kMax },
      side,
      mode,
      price,
      k,
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
    const levels = Number.isFinite(config.levels) ? Math.max(1, Math.round(config.levels)) : 8;
    const sizeLadder = Array.isArray(config.sizes)
      ? config.sizes.map((val) => Math.max(1, Math.round(val)))
      : [40, 30, 22, 16, 12, 9, 7, 5];
    const sizeAt = (i) => sizeLadder[i] ?? sizeLadder[sizeLadder.length - 1] ?? 1;

    this.activeOrderIds.clear();
    this.activeOrderTargets.clear();

    for (let i = 1; i <= levels; i += 1) {
      const dist = baseDistance + i * stepTicks;
      const bidPrice = roundToTick(midPrice - dist * tick, tick);
      const askPrice = roundToTick(midPrice + dist * tick, tick);
      const size = sizeAt(i - 1);
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
