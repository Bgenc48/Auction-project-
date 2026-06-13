# RL Spear Bid Assistant

A Chrome extension for bidding on **bid.rlspear.com** (a **Maxanet** auction site).
It helps you win the way this platform actually rewards — by managing your
**Max Bids** and reacting fast — instead of chasing last-second snipes that the
site is built to defeat.

## Why not "snipe the last second"?

This auction uses **Dynamic Closing**: *any* bid placed in the last 4 minutes
pushes the closing time out another 4 minutes. So a last-second bid can't steal
a lot — it just restarts the clock. The site also has a built-in **Max Bid**
(proxy) robot: you enter the most you'd pay, and it bids the minimum needed on
your behalf, instantly, even while you sleep.

**On this platform, the highest Max Bid wins — not the latest click.** This
extension is built around that reality.

## What it does

- 📋 **Multi-lot tracker** — one dashboard for every lot you care about across a
  1,500+ item auction: current bid, your max, time left, winning/outbid.
- ⚠️ **Instant outbid alerts** — a desktop notification the moment a tracked lot
  flips to "outbid," so you can decide whether to raise your max in time.
- ⏰ **Closing-soon alerts** — a heads-up when a tracked lot is within N minutes
  of closing.
- 🎯 **Target Max + "Put on page"** — record the most you'd pay for each lot, and
  one click pre-fills the site's Max Bid box with it (you review and click Bid
  yourself — the extension never submits a bid).
- 💰 **eBay sold-comps** — one click opens completed/sold listings for the lot
  title so you set your max with real resale data.

It is **read-only** toward the auction: it watches the page and fills a field on
request, but **you place every bid**. Nothing bids automatically.

## Install (Windows / Chrome)

1. Download this branch as a ZIP (green **`< > Code`** → **Download ZIP**) and
   **Extract All**.
2. Go to `chrome://extensions`, turn on **Developer mode** (top-right).
3. **Load unpacked** → select the **`extension`** folder (the one with
   `manifest.json`).
4. Pin it via the 🧩 puzzle icon.

## Use it

1. Log into **bid.rlspear.com** and open the auction (the grid/list of lots, or a
   single lot's detail page).
2. Click the extension → expand **"Add lots from this page"** → click **Track**
   on the lots you want. (Tip: use the site's search/filter to find specific
   lots first.)
3. In **Tracked lots**, set a **Target $** (your true max) for each. Click
   **eBay $** to sanity-check value.
4. Click **Put on page** to drop your Target into the site's Max Bid box, then
   **review and hit Bid yourself** on the site.
5. Keep Chrome running with a rlspear tab open. If anyone outbids you, you'll get
   a desktop alert — raise your max if it's still worth it.

## How the live tracking works

The content script reads each lot from Maxanet's markup — the per-item
`#AuctionItemId_*` / `#MaxBidAmount_*` fields, the `.remain-time` countdown
(which carries the exact end time **and** the server's clock, so time-left is
accurate), and the win/outbid styling (`.public-winning-button-style` /
`.public-outbid-button-style`). A `MutationObserver` catches the live re-render
the site does whenever a bid lands, so outbid alerts are near-instant while the
tab is open.

## Files

```
extension/
  manifest.json
  src/
    selectors.js   Reads Maxanet lots off the page (read-only)
    content.js     Scans + watches for live changes; pre-fills Max Bid on request
    background.js  Tracked-lot store, outbid + closing-soon alerts
    popup.html/.js/.css  Dashboard
    options.html/.js     Per-lot activity log
  icons/
```

## Privacy

Everything stays local (`chrome.storage.local`). No servers, no accounts, no
password storage. The only tabs it opens are ones you ask for (a lot page, or
eBay comps).

## Limitations (honest)

- Alerts need **Chrome open with a rlspear tab** — they fire from the live page,
  not a cloud server.
- It can't tell you what a lot is "worth"; the comps button helps you decide.
- If a lot's bid box uses different markup in some view and "Put on page" can't
  find it, open that lot's **detail page** and try again.

---

*Personal-use helper for your own rlspear account. You place every bid.*
