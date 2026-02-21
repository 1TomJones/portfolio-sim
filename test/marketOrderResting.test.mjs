import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { MarketEngine } from "../src/engine/marketEngine.js";

const TICK = 0.5;

function createEngine() {
  const engine = new MarketEngine({
    defaultPriceMode: "orderflow",
    orderBook: { tickSize: TICK },
  });
  engine.startRound({ startPrice: 100 });
  return engine;
}

describe("executeMarketOrder long-only behavior", () => {
  it("clips sells to available position and never goes negative", () => {
    const engine = createEngine();
    const seller = engine.registerPlayer("seller", "Seller");
    const buyer = engine.registerPlayer("buyer", "Buyer");

    seller.position = 2;
    const ask = engine.submitOrder("seller", { type: "limit", side: "SELL", price: 100, quantity: 5 });
    assert.ok(ask.ok, "sell limit should be accepted when the player has inventory");
    assert.equal(ask.resting.remainingUnits, 2, "sell quantity should be clipped to current holdings");

    const buy = engine.submitOrder("buyer", { type: "market", side: "BUY", quantity: 5 });
    assert.ok(buy.ok, "market buy should be accepted");
    engine.stepTick();
    assert.equal(seller.position, 0, "seller should not go negative after overselling attempt");
  });

  it("rejects sell orders when the player has no position", () => {
    const engine = createEngine();
    const seller = engine.registerPlayer("seller", "Seller");

    const sell = engine.submitOrder("seller", { type: "market", side: "SELL", quantity: 1 });
    assert.equal(sell.ok, false, "market sell should be rejected without inventory");
    assert.equal(sell.reason, "position-limit");
    assert.equal(seller.position, 0);
  });
});
