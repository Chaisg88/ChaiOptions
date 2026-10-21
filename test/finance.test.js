import { test } from "node:test";
import assert from "node:assert/strict";
import {
  openingCash,
  closingCash,
  realized,
  events,
} from "../public/finance.js";
const base = {
  id: "a",
  symbol: "AAPL",
  strategy: "sell_put",
  quantity: 2,
  multiplier: 100,
  premium: 2.5,
  fees: 1.3,
  date: "2026-10-20",
  close: { date: "2026-10-21", premium: 0.6, fees: 1.3 },
};
test("sold put early buyback subtracts closing premium and fees", () => {
  assert.equal(openingCash(base), 498.7);
  assert.equal(closingCash(base), -121.3);
  assert.ok(Math.abs(realized(base) - 377.4) < 1e-9);
});
test("sold call losing close is a loss", () =>
  assert.equal(
    realized({
      ...base,
      strategy: "sell_call",
      close: { ...base.close, premium: 4, fees: 1.3 },
    }),
    -302.59999999999997,
  ));
test("bought put subtracts paid opening premium from closing proceeds", () => {
  const t = {
    ...base,
    strategy: "buy_put",
    close: { ...base.close, premium: 4, fees: 1.3 },
  };
  assert.ok(Math.abs(realized(t) - 297.4) < 1e-9);
  assert.equal(openingCash(t), -501.3);
});
test("open premiums are cash flow, never realized profit", () => {
  const t = { ...base, close: null };
  assert.equal(realized(t), null);
  assert.equal(events([t]).length, 1);
});
test("expiration at zero keeps sold premium less fees", () =>
  assert.equal(
    realized({ ...base, close: { ...base.close, premium: 0, fees: 0 } }),
    498.7,
  ));
test("daily cash events preserve opening and closing dates", () => {
  const e = events([base]);
  assert.deepEqual(
    e.map((x) => x.date),
    ["2026-10-20", "2026-10-21"],
  );
  assert.ok(
    Math.abs(e.reduce((n, x) => n + x.amount, 0) - realized(base)) < 1e-9,
  );
});
test("custom multiplier applies to both legs", () => {
  assert.equal(
    realized({
      ...base,
      multiplier: 10,
      fees: 0,
      close: { ...base.close, fees: 0 },
    }),
    38,
  );
});
