"use strict";
// Tests for background.js's liveEndEpoch: it converts a snapshot's end time to
// an absolute epoch using the server clock, so the local clock isn't trusted.
const { test } = require("node:test");
const assert = require("node:assert");
const { loadBackground } = require("./support/load");

const { liveEndEpoch, closedOutcome } = loadBackground();
assert.strictEqual(typeof liveEndEpoch, "function", "liveEndEpoch should load");
assert.strictEqual(typeof closedOutcome, "function", "closedOutcome should load");

test("returns null when there is no end time", () => {
  assert.strictEqual(liveEndEpoch({ endMs: null, serverNowMs: 1000 }), null);
});

test("returns the raw end time when the server clock is unknown", () => {
  assert.strictEqual(liveEndEpoch({ endMs: 5000, serverNowMs: null }), 5000);
});

test("applies local-vs-server skew to the end time", () => {
  const endMs = 1_000_000;
  const serverNowMs = Date.now() - 30_000; // server clock 30s behind local
  const before = Date.now();
  const got = liveEndEpoch({ endMs, serverNowMs });
  const after = Date.now();
  // got === endMs + (Date.now() - serverNowMs); bracket Date.now() drift.
  assert.ok(got >= endMs + (before - serverNowMs), "skew not under-applied");
  assert.ok(got <= endMs + (after - serverNowMs), "skew not over-applied");
});

test("no skew when the server clock matches local", () => {
  const now = Date.now();
  const got = liveEndEpoch({ endMs: 2_000_000, serverNowMs: now });
  assert.ok(Math.abs(got - 2_000_000) <= 5, "≈ end time when clocks agree");
});

test("closedOutcome maps last-seen status to a final result", () => {
  assert.strictEqual(closedOutcome("winning"), "won");
  assert.strictEqual(closedOutcome("outbid"), "lost");
  assert.strictEqual(closedOutcome("none"), "ended");
  assert.strictEqual(closedOutcome(undefined), "ended");
});
