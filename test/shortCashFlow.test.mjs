import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { MarketEngine } from "../src/engine/marketEngine.js";

function createEngine() {
  const engine = new MarketEngine({ longOnly: false, defaultPriceMode: "impact" });
  engine.startRound({ startPrice: 100 });
  engine.priceMode = "impact";
  return engine;
}

describe("cash-constrained execution", () => {
  it("clips market buys to keep cash non-negative", () => {
    const engine = createEngine();
    const trader = engine.registerPlayer("trader", "Trader");

    trader.cash = 250;

    const firstBuy = engine.executeMarketOrderForPlayer({ id: "trader", side: "BUY", quantity: 4 });
    assert.equal(firstBuy.filled, true);
    assert.equal(firstBuy.qty, 2);
    assert.equal(trader.position, 2);
    assert.equal(trader.cash, 50);

    const secondBuy = engine.executeMarketOrderForPlayer({ id: "trader", side: "BUY", quantity: 1 });
    assert.equal(secondBuy.filled, false);
    assert.equal(trader.position, 2);
    assert.equal(trader.cash, 50);
  });

  it("prevents short openings that would push cash negative", () => {
    const engine = createEngine();
    const trader = engine.registerPlayer("trader", "Trader");

    trader.cash = 0;
    const blockedShort = engine.executeMarketOrderForPlayer({ id: "trader", side: "SELL", quantity: 2 });
    assert.equal(blockedShort.filled, false);
    assert.equal(trader.position, 0);
    assert.equal(trader.cash, 0);

    trader.cash = 300;
    const allowedShort = engine.executeMarketOrderForPlayer({ id: "trader", side: "SELL", quantity: 5 });
    assert.equal(allowedShort.filled, true);
    assert.equal(allowedShort.qty, -3);
    assert.equal(trader.position, -3);
    assert.equal(trader.cash, 0);
  });
});
