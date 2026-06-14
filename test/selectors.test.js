"use strict";
// Unit tests for the pure value-engine helpers in extension/src/selectors.js
// (parseMoney, parseTitleValue, valuation). Run: npm test  (node --test)
const { test } = require("node:test");
const assert = require("node:assert");
const { loadSelectors } = require("./support/load");

const S = loadSelectors();
assert.ok(S, "selectors.js should publish RLSpearSelectors onto window");

test("parseMoney handles plain, formatted, spaced, and junk input", () => {
  assert.strictEqual(S.parseMoney("$1,234.56"), 1234.56);
  assert.strictEqual(S.parseMoney("42"), 42);
  assert.strictEqual(S.parseMoney("  $ 7 "), 7);
  assert.strictEqual(S.parseMoney("no money here"), null);
  assert.strictEqual(S.parseMoney(null), null);
});

test("parseTitleValue extracts retail, condition, and quantity", () => {
  const v = S.parseTitleValue("Like New Air Fryer, Retail $89.99, set of 3 units");
  assert.strictEqual(v.retail, 89.99);
  assert.strictEqual(v.condition, "Like New");
  assert.strictEqual(v.qty, 3);
});

test("parseTitleValue accepts MSRP and a trailing 'retail'", () => {
  assert.strictEqual(S.parseTitleValue("MSRP: $50 widget").retail, 50);
  assert.strictEqual(S.parseTitleValue("$80 retail gizmo").retail, 80);
});

test("parseTitleValue returns null retail when no price is present", () => {
  assert.strictEqual(S.parseTitleValue("Mystery box, no price").retail, null);
  assert.strictEqual(Object.keys(S.parseTitleValue("")).length, 0);
});

test("valuation adds buyer's premium and rounds discount", () => {
  const v = S.valuation(100, 200, 13);
  assert.strictEqual(v.allIn, 113);      // 100 * 1.13
  assert.strictEqual(v.discountPct, 44); // round((1 - 113/200) * 100)
  assert.strictEqual(v.retail, 200);
});

test("valuation treats a missing bid as 0", () => {
  const v = S.valuation(null, 100, 0);
  assert.strictEqual(v.allIn, 0);
  assert.strictEqual(v.discountPct, 100);
});

test("valuation returns null without a usable retail", () => {
  assert.strictEqual(S.valuation(10, 0, 13), null);
  assert.strictEqual(S.valuation(10, null, 13), null);
});

test("allIn adds the buyer's premium and rounds to cents", () => {
  assert.strictEqual(S.allIn(100, 13), 113);
  assert.strictEqual(S.allIn(49.99, 13), 56.49); // 56.4887 → 56.49
  assert.strictEqual(S.allIn(100, 0), 100);
});

test("allIn is 0 for missing or non-positive amounts", () => {
  assert.strictEqual(S.allIn(null, 13), 0);
  assert.strictEqual(S.allIn(0, 13), 0);
  assert.strictEqual(S.allIn("nope", 13), 0);
});
