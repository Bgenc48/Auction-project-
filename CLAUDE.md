# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## What this project is

A **Chrome extension (Manifest V3)** that assists bidding on **bid.rlspear.com**,
a white-label of the **Maxanet** online-auction platform
(`spear.prod2.maxanet.auction`, tenant `Wil607`). It is a personal-use helper
for the user's own account.

The extension does **not** bid automatically. It tracks lots, alerts the user
the moment they're outbid, ranks lots by real discount off retail, and (on
request) pre-fills the site's native **Max Bid** box for the user to submit.

### Why it's a Max-Bid tool, not a sniper
The auction uses **Dynamic Closing**: any bid in the final 4 minutes extends the
close by 4 minutes, which defeats last-second sniping. Maxanet also provides a
native **Max Bid (proxy)** robot. On this platform the **highest Max Bid wins,
not the latest click** — so the whole design centers on managing Max Bids and
reacting fast, never on racing the clock.

## Repository layout

```
extension/
  manifest.json          MV3 manifest (permissions, content scripts, popup)
  src/
    selectors.js         Read-only page reader + value engine (no chrome.* APIs)
    content.js           Per-page scan, MutationObserver, scanAll, keep-alive,
                         Max-Bid pre-fill, calibration picker
    background.js         Service worker: tracked-lot store, alerts, catalog
    popup.html/.js/.css   Dashboard UI
    options.html/.js      Per-lot activity log
  icons/                 16/48/128 px PNGs (generated)
test/
  selectors.test.js      Value-engine unit tests (parseMoney/parseTitleValue/valuation)
  scan-items.test.js     scanItems / card-reader tests over a tiny DOM shim
  background.test.js     liveEndEpoch server-clock skew tests
  support/               Zero-dependency DOM shim + vm loaders for the tests
package.json             Wires up `npm test` (node --test, no deps, no build)
README.md                User-facing install + usage guide
CLAUDE.md                This file
```

There is no build step. It loads unpacked as-is.

## Architecture & data flow

1. **`selectors.js`** runs in both the content script and the popup. It exposes
   `window.RLSpearSelectors` with pure, DOM-reading helpers:
   `scanItems(root=document)`, `parseTitleValue(title)`, `valuation(bid, retail,
   premiumPct)`, `auctionIdFromPage()`, `buildSelector()`. It never touches
   `chrome.*` so it's reusable in any page context.
2. **`content.js`** scans the page into item snapshots and posts `pageItems` to
   the background worker. A `MutationObserver` (childList only — *not*
   characterData, to avoid the 1 s countdown churn) triggers a debounced rescan
   when Maxanet re-renders an item after a bid. It also:
   - `scanAll`: sweeps every page via the site's own `/Public/Auction/GetAuctionItems`
     endpoint (cookie session, `X-Requested-With`), parsing each HTML page with
     `DOMParser` and reusing `scanItems(doc)`.
   - `prefillMax`: fills `#MaxBidAmount_<index>` and scrolls to it. **Never submits.**
   - `keepAlive`: pings `/Public/Login/KeepSessionAlive` every 4 min.
3. **`background.js`** owns persisted state in `chrome.storage.local`
   (`tracked`, `settings`, `catalog`). It diffs incoming snapshots against
   tracked lots and fires desktop notifications on the winning→outbid transition
   and on "closing soon". All message handling is **serialized through a promise
   chain** to avoid read-modify-write races between frequent `pageItems` and user
   actions.
4. **`popup.js`** is the dashboard: tracked lots, "add from this page",
   best-value finder, settings. It talks to the background for state and to the
   active tab's content script for live reads / pre-fill.

## Confirmed Maxanet markup (the contract the reader depends on)

- Per item: `input#AuctionItemId_<index>` (value = inventory id),
  `input#BidAmount_<index>`, `input#MaxBidAmount_<index>`.
- Countdown: `.remain-time[data-enddate][data-currentdate][data-auctionitemid]`.
  `data-currentdate` is the **server clock** — use it to compute time-left
  without trusting the local clock (`liveEndEpoch` in background.js).
- Win/outbid state: CSS classes `.public-winning-button-style` /
  `.public-outbid-button-style`.
- Titles: `.auction-item-title` (often embeds `Retail $…`, condition, quantity —
  the basis of the value engine).
- Hidden page fields: `#hdn_AuctionId` (numeric, e.g. 16950), `#hdn_AucId`
  (obfuscated, URL-encoded). Two ID forms coexist; keep both.
- Listing items load via AJAX; the request payload is mirrored in
  `localStorage["AuctionItemData"]` (used by `scanAll`).

## Endpoints (all under /Public/, cookie-session auth)

Read: `Auction/GetAuctionItems` (HTML), `Auction/GetAuctionItemBasicInfo`,
`Auction/RefreshItem`, `Auction/GetBidlist?AuctionItemId=`,
`Auction/GetAuctionTotalsById?auctionId=`, `Lookup/GetCategories`.
Session: `Login/KeepSessionAlive`, `Login/CheckSessionAlive`.

**Write endpoints exist but are intentionally NOT used.** `Auction/SubmitBid`,
`SubmitBuyNow`, `AddToWatchList`, etc. require a per-item ASP.NET
`__RequestVerificationToken` and change account state / create financial
obligations. Do not wire automated bidding without explicit user direction, a
per-bid confirmation gate, a hard budget ceiling, and testing against a
non-live auction.

## Conventions & guardrails

- **Read-only toward the auction.** The extension may fill a field on request,
  but the user places every bid. No password/token storage; everything stays in
  `chrome.storage.local`.
- Keep `selectors.js` free of `chrome.*` APIs (it loads in the popup too).
- Prefer reacting to the site's live re-render over polling.
- The value engine only ranks lots whose title contains an explicit retail
  price — never fabricate a value. All-in cost = `bid × (1 + premiumPct/100)`.
- Match the existing terse, commented style. No frameworks, no build step.

## Validate changes

The value-engine helpers in `selectors.js` have unit tests; everything else is
verified by hand. After edits, at minimum:

```sh
python3 -c "import json; json.load(open('extension/manifest.json'))"   # manifest valid
for f in extension/src/*.js; do node --check "$f"; done                 # JS parses
npm test                                                                # value engine
```

Then load unpacked in Chrome (`chrome://extensions` → Developer mode → Load
unpacked → select `extension/`) and smoke-test on the live auction:
1. Popup → "Add lots from this page" shows titles + prices.
2. Best-value finder → "Scan whole auction" returns hundreds of lots.
3. Track a lot, set a Target, "Put on page" fills `#MaxBidAmount_*`.

## Known open items

- Current-bid parsing and the `GetAuctionItems` scan are written to the
  confirmed markup but were not verifiable against the live authenticated site
  from the dev environment — confirm via the smoke test; if a lot card differs,
  capture one card's `outerHTML` and tune `selectors.js`.
- Real-time updates currently come from the DOM (MutationObserver). Maxanet also
  pushes via **PubNub** (sub key in page source, channels `bid_refresh<invId>`,
  `auction_halt<aucId>`, `bid_groupitem_refresh<aucId>`); a future enhancement
  could subscribe directly for lower latency.
