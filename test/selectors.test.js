"use strict";
/*
 * Zero-dependency unit tests for the pure value-engine helpers in
 * extension/src/selectors.js (parseMoney, parseTitleValue, valuation).
 *
 * selectors.js is a browser IIFE that publishes onto `window`; the DOM-reading
 * helpers reference globals (document, CSS, location…) only when *called*, so we
 * can load it in a minimal sandbox and exercise the pure functions directly —
 * no jsdom, no npm install. Run:  node test/selectors.test.js
 */
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const file = path.join(__dirname, "..", "extension", "src", "selectors.js");
const sandbox = { window: {}, CSS: { escape: (s) => s } };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(file, "utf8"), sandbox);

const S = sandbox.window.RLSpearSelectors;
assert.ok(S, "selectors.js should publish RLSpearSelectors onto window");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log("ok -", name); }

check("parseMoney handles plain, formatted, spaced, and junk input", () => {
  assert.strictEqual(S.parseMoney("$1,234.56"), 1234.56);
  assert.strictEqual(S.parseMoney("42"), 42);
  assert.strictEqual(S.parseMoney("  $ 7 "), 7);
  assert.strictEqual(S.parseMoney("no money here"), null);
  assert.strictEqual(S.parseMoney(null), null);
});

check("parseTitleValue extracts retail, condition, and quantity", () => {
  const v = S.parseTitleValue("Like New Air Fryer, Retail $89.99, set of 3 units");
  assert.strictEqual(v.retail, 89.99);
  assert.strictEqual(v.condition, "Like New");
  assert.strictEqual(v.qty, 3);
});

check("parseTitleValue accepts MSRP and a trailing 'retail'", () => {
  assert.strictEqual(S.parseTitleValue("MSRP: $50 widget").retail, 50);
  assert.strictEqual(S.parseTitleValue("$80 retail gizmo").retail, 80);
});

check("parseTitleValue returns null retail when no price is present", () => {
  assert.strictEqual(S.parseTitleValue("Mystery box, no price").retail, null);
  assert.strictEqual(Object.keys(S.parseTitleValue("")).length, 0);
});

check("valuation adds buyer's premium and rounds discount", () => {
  const v = S.valuation(100, 200, 13);
  assert.strictEqual(v.allIn, 113);      // 100 * 1.13
  assert.strictEqual(v.discountPct, 44); // round((1 - 113/200) * 100)
  assert.strictEqual(v.retail, 200);
});

check("valuation treats a missing bid as 0", () => {
  const v = S.valuation(null, 100, 0);
  assert.strictEqual(v.allIn, 0);
  assert.strictEqual(v.discountPct, 100);
});

check("valuation returns null without a usable retail", () => {
  assert.strictEqual(S.valuation(10, 0, 13), null);
  assert.strictEqual(S.valuation(10, null, 13), null);
});

console.log(`\n${passed} checks passed`);
