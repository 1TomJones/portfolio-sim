import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { MarketEngine } from "../src/engine/marketEngine.js";

function createEngine() {
  const engine = new MarketEngine({ longOnly: false, defaultPriceMode: "impact" });
  engine.startRound({ startPrice: 100 });
  engine.priceMode = "impact";
  return engine;
}

describe("short position cash flow", () => {
  it("reduces cash when increasing a short and restores it when covering", () => {
    const engine = createEngine();
    const trader = engine.registerPlayer("trader", "Trader");

    const firstShort = engine.executeMarketOrderForPlayer({ id: "trader", side: "SELL", quantity: 2 });
    assert.equal(firstShort.filled, true);
    assert.equal(trader.position, -2);
    assert.equal(trader.cash, -200);
    assert.equal(trader.pnl, 0);

    const secondShort = engine.executeMarketOrderForPlayer({ id: "trader", side: "SELL", quantity: 1 });
    assert.equal(secondShort.filled, true);
    assert.equal(trader.position, -3);
    assert.equal(trader.cash, -300);
    assert.equal(trader.pnl, 0);

    const partialCover = engine.executeMarketOrderForPlayer({ id: "trader", side: "BUY", quantity: 1 });
    assert.equal(partialCover.filled, true);
    assert.equal(trader.position, -2);
    assert.equal(trader.cash, -200);
    assert.equal(trader.pnl, 0);
  });
});
