# RL Spear Bid Assistant

A Chrome extension that helps you bid smarter on **bid.rlspear.com**:

- 📋 **Watchlist + live tracking** — see current price, time left, and whether
  you're the high bidder, all in one popup.
- 🎯 **Snipe** — automatically place your bid in the final seconds (you set how
  many) up to a max you choose, so you stop getting outbid at the last moment.
- 🛡️ **Auto-defend (proxy)** — for "soft-close" auctions that extend when bids
  land late, instantly re-bid (up to your max) the moment you're outbid.
- 💰 **eBay sold-comps helper** — one click opens completed/sold eBay listings
  for the lot title so you can decide what it's actually worth.
- 🧪 **Dry run by default** — it will not place a single real bid until you
  confirm it's aiming at the right buttons and turn dry run off.

---

## ⚠️ Read this first (honest limitations)

1. **Your computer + Chrome must be on and awake when a lot closes.** This is a
   browser tool, not a cloud robot. It opens/refreshes the lot tab ~2.5 minutes
   before close and fires the bid in the final seconds — but only if the browser
   is running. Keep it set as a backup, watch the desktop notifications.
2. **Auto-bidding very likely violates the auction site's Terms of Service.**
   Most auction platforms prohibit automated bidding. This is your own account
   and your decision; the realistic worst case is account suspension. The tool
   uses *your* logged-in session and never stores your password.
3. **No tool can truly "know" what an estate/liquidation lot is worth.** That's
   why valuation is *manual*: you set the max, and the eBay comps button gives
   you real sold data to set it well. There's no magic number.
4. **Soft-close auctions defeat true sniping by design.** If rlspear extends the
   clock whenever a late bid lands, use **Auto-defend** mode instead of Snipe.

---

## Install (load unpacked)

1. Open Chrome → `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select the `extension/` folder from this repo.
4. Pin the extension (puzzle-piece icon → pin "RL Spear Bid Assistant").

> Works in any Chromium browser (Chrome, Edge, Brave).

## First-time setup (2 minutes)

1. Log in to **bid.rlspear.com** as usual and open any single **lot** page.
2. Click the extension icon. The popup shows what it read from the page
   (title, current price, time left, win/outbid status).
3. If anything shows "—" or looks wrong, open **Settings & calibration** and
   click the field button (e.g. *Bid button*), then click that element on the
   page. Repeat for anything that's missing. This is only needed once per site.
4. Set your **max $**, pick a **mode** (Snipe / Auto-defend / Track only), set
   the snipe lead seconds, and click **Watch lot**.
5. **Test it safely:** with **Dry run ON**, click *Test bid on this page*. Check
   the popup/Options log — it will say *"[DRY RUN] Would bid $X… Button found:
   true"*. If it found the button and the amount, you're calibrated.
6. When you're confident, open **Settings** and turn **Dry run OFF** to let it
   place real bids.

## How sniping works

- For each **Snipe** lot, the background worker sets an alarm ~2.5 min before
  close and opens/refreshes that lot's tab.
- The content script then reads the **live on-page countdown** (not your PC
  clock, to avoid drift) and, at `T-<lead> seconds`, places the next required
  bid — but only if you're not already winning and the next bid is `≤ your max`.
- If the next required bid would exceed your max, it **stops** and logs it. It
  never bids past your number.

## Modes

| Mode | When to use | Behavior |
|------|-------------|----------|
| **Snipe** | Hard-close auctions (fixed end time) | Waits, bids once in the final seconds up to your max. |
| **Auto-defend** | Soft-close / "popcorn" auctions that extend | Re-bids up to your max as soon as it sees you outbid. |
| **Track only** | Just watching | No bids; live price/status tracking + notifications. |

## Files

```
extension/
  manifest.json         MV3 manifest
  src/
    selectors.js        Reads title/price/time/status; auto-detect + calibration
    content.js          Per-page reader, end-game timer, bid execution, picker
    background.js        Watchlist + settings storage, alarms, notifications
    popup.html/.js/.css  Dashboard UI
    options.html/.js     Activity log
  icons/                Toolbar icons
```

## Privacy

Everything stays on your machine (`chrome.storage.local`). No servers, no
accounts, no password storage. The only outbound navigation it triggers is
opening eBay (comps) or rlspear lot tabs that you chose to watch.

## Troubleshooting

- **"Bid button not found"** → run Calibrate and click the actual bid button.
- **Snipe didn't fire** → the browser was closed/asleep, or the tab wasn't
  allowed to open. Keep Chrome running; check `chrome://extensions` for errors.
- **It bid the wrong amount** → set a fixed **bid increment** in Settings, or
  calibrate the *Bid amount box* so it reads the site's required next bid.
- **Bid needs a confirmation popup** → it tries to auto-click Confirm/Yes/OK;
  if the site uses a custom dialog, calibrate isn't enough — open an issue.

---

*This is a personal-use assistant for your own rlspear account. Bid responsibly.*
