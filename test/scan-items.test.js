"use strict";
// DOM-level tests for selectors.scanItems against fixtures mirroring the
// confirmed Maxanet markup (CLAUDE.md). Uses the zero-dependency DOM shim.
const { test } = require("node:test");
const assert = require("node:assert");
const { loadSelectors } = require("./support/load");
const { el, root } = require("./support/dom");

const S = loadSelectors();

// Build one item card. Omit bidValue/labelledBid to model "no current bid".
function card({ idx, itemId, title, status, bidValue, labelledBid, maxValue, end, now }) {
  const kids = [
    el("input", { id: "AuctionItemId_" + idx, value: String(itemId) }),
    el("div", { class: "auction-item-title", text: title }),
    el("input", { id: "BidAmount_" + idx, value: bidValue == null ? "" : String(bidValue) }),
    el("input", { id: "MaxBidAmount_" + idx, value: maxValue == null ? "" : String(maxValue) }),
    el("div", { class: status === "outbid" ? "public-outbid-button-style" : "public-winning-button-style", text: status }),
    el("div", { class: "remain-time", "data-enddate": end, "data-currentdate": now, "data-auctionitemid": String(itemId) }),
    el("a", { href: "https://bid.rlspear.com/Public/Auction/AuctionItemDetail?id=" + itemId, text: "details" }),
  ];
  if (labelledBid != null) kids.push(el("div", { text: "Current Bid: $" + labelledBid }));
  return el("div", { class: "auction-item" }, kids);
}

test("scanItems reads id, index, status, max bid, retail, and end time", () => {
  const r = root([card({
    idx: 0, itemId: 555, title: "Brand New Drill — Retail $129.99",
    status: "winning", labelledBid: 45, maxValue: 75,
    end: "2026-06-14 12:00:00", now: "2026-06-14 11:30:00",
  })]);
  const items = S.scanItems(r);
  assert.strictEqual(items.length, 1);
  const it = items[0];
  assert.strictEqual(it.id, "555");
  assert.strictEqual(it.index, "0");
  assert.strictEqual(it.status, "winning");
  assert.strictEqual(it.currentBid, 45);
  assert.strictEqual(it.myMaxBid, 75);
  assert.strictEqual(it.value.retail, 129.99);
  assert.strictEqual(it.endMs, new Date("2026/06/14 12:00:00").getTime());
});

test("current bid falls back to the BidAmount input when unlabelled", () => {
  const r = root([card({
    idx: 0, itemId: 1, title: "Thing — Retail $200", status: "winning",
    bidValue: 60, end: "2026-06-14 12:00:00", now: "2026-06-14 11:00:00",
  })]);
  assert.strictEqual(S.scanItems(r)[0].currentBid, 60);
});

test("retail in the title is NOT misread as the current bid (regression)", () => {
  const r = root([card({
    idx: 0, itemId: 7, title: "Sealed TV — Retail $899.00", status: "outbid",
    end: "2026-06-14 12:00:00", now: "2026-06-14 11:00:00",
  })]);
  const it = S.scanItems(r)[0];
  assert.strictEqual(it.currentBid, null, "no labelled bid and empty BidAmount → null");
  assert.strictEqual(it.value.retail, 899);
  assert.strictEqual(it.status, "outbid");
});

test("scanItems enumerates multiple cards in order", () => {
  const r = root([
    card({ idx: 0, itemId: 11, title: "A — Retail $10", status: "winning", bidValue: 1, end: "2026-06-14 12:00:00", now: "2026-06-14 11:00:00" }),
    card({ idx: 1, itemId: 12, title: "B — Retail $20", status: "outbid", bidValue: 2, end: "2026-06-14 12:05:00", now: "2026-06-14 11:00:00" }),
  ]);
  const ids = S.scanItems(r).map((i) => i.id);
  assert.deepStrictEqual([...ids], ["11", "12"]); // re-wrap: scanItems' array is from the vm realm
});
