/*
 * content.js
 * ----------------------------------------------------------------------------
 * Runs inside every rlspear page. Responsibilities:
 *   1. Continuously read the current lot (title, price, time left, win status)
 *      and report it to the background service worker.
 *   2. Run the precise end-game timer when this tab is on a watched lot that
 *      is closing soon — and fire the bid (snipe) or defend (proxy) action.
 *   3. Provide the "Calibrate" element picker used from the popup.
 *
 * SAFETY: when settings.dryRun is true (the default), it NEVER actually clicks
 * the bid button — it only logs what it WOULD have done. You turn dry-run off
 * from the popup once you've confirmed calibration is correct.
 * ----------------------------------------------------------------------------
 */

(function () {
  "use strict";

  const S = window.RLSpearSelectors;
  if (!S) return;

  let settings = null;
  let watchEntry = null; // the watchlist record for THIS lot, if any
  let reportTimer = null;
  let endgameRAF = null;
  let firedThisLoad = false; // guard so we only attempt a snipe once per page load

  const host = location.host;

  // ---- helpers ------------------------------------------------------------
  function customSelectors() {
    const all = (settings && settings.selectors) || {};
    return all[host] || {};
  }

  function readLot() {
    const cs = customSelectors();
    return {
      key: S.lotKeyFromUrl(location.href),
      url: location.href,
      title: S.findTitle(cs),
      currentPrice: S.findCurrentPrice(cs),
      secondsLeft: S.findSecondsLeft(cs),
      status: S.findStatus(cs),
      seenAt: Date.now()
    };
  }

  function log(entry, msg) {
    chrome.runtime.sendMessage({ type: "lotLog", key: entry.key, msg, at: Date.now() });
    console.log("[RLSpear]", msg);
  }

  // ---- reporting loop -----------------------------------------------------
  function startReporting() {
    if (reportTimer) clearInterval(reportTimer);
    const tick = () => {
      const lot = readLot();
      chrome.runtime.sendMessage({ type: "lotUpdate", lot }, (resp) => {
        // background returns the watch entry + latest settings for this lot
        if (chrome.runtime.lastError) return;
        if (resp) {
          settings = resp.settings || settings;
          watchEntry = resp.entry || null;
          maybeRunEndgame(lot);
        }
      });
    };
    tick();
    reportTimer = setInterval(tick, 3000);
  }

  // ---- end-game (snipe / defend) ------------------------------------------
  function maybeRunEndgame(lot) {
    if (!watchEntry || !watchEntry.enabled || watchEntry.mode === "off") return;
    if (lot.secondsLeft == null) return;

    if (watchEntry.mode === "defend") {
      // Proxy/defend: the moment we see we're outbid and price is still within
      // budget, bid the next increment. (Best for soft-close auctions.)
      if (lot.status === "outbid") {
        attemptBid(lot, "defend: detected outbid");
      }
      return;
    }

    // mode === "snipe": kick off a precise timer when we're inside the window.
    const lead = Number(watchEntry.snipeLeadSeconds) || (settings && settings.defaultLeadSeconds) || 6;
    if (lot.secondsLeft <= lead + 25 && !endgameRAF && !firedThisLoad) {
      runSnipeCountdown(lead);
    }
  }

  function runSnipeCountdown(lead) {
    log(watchEntry, `Snipe armed: will bid at T-${lead}s (live countdown).`);
    const cs = customSelectors();
    const loop = () => {
      const secs = S.findSecondsLeft(cs);
      if (secs == null) {
        endgameRAF = requestAnimationFrame(loop);
        return;
      }
      if (secs <= lead) {
        endgameRAF = null;
        const lot = readLot();
        attemptBid(lot, `snipe: T-${secs}s reached`);
        return;
      }
      endgameRAF = requestAnimationFrame(loop);
    };
    endgameRAF = requestAnimationFrame(loop);
  }

  function computeNextBid(lot) {
    const inc = Number((settings && settings.bidIncrement)) || 0;
    const cs = customSelectors();
    const inputEl = S.findBidInput(cs);

    // If the bid input already holds the site's required next bid, trust it.
    if (inputEl && S.parseMoney(inputEl.value)) {
      return S.parseMoney(inputEl.value);
    }
    if (lot.currentPrice == null) return null;
    if (inc > 0) return Math.round((lot.currentPrice + inc) * 100) / 100;
    // No increment configured and no input value: just bump by smallest sane step.
    return Math.round((lot.currentPrice + 1) * 100) / 100;
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function attemptBid(lot, reason) {
    if (firedThisLoad && (watchEntry && watchEntry.mode === "snipe")) return;
    const cs = customSelectors();
    const max = Number(watchEntry.maxBid);
    if (!Number.isFinite(max) || max <= 0) {
      log(watchEntry, `Skip (${reason}): no max bid set.`);
      return;
    }
    if (lot.status === "winning") {
      log(watchEntry, `Skip (${reason}): you're already the high bidder.`);
      return;
    }

    const nextBid = computeNextBid(lot);
    if (nextBid == null) {
      log(watchEntry, `Skip (${reason}): couldn't read the required bid amount.`);
      return;
    }
    if (nextBid > max + 1e-6) {
      log(watchEntry, `STOP (${reason}): next bid $${nextBid} exceeds your max $${max}. Not bidding.`);
      chrome.runtime.sendMessage({ type: "snipeResult", key: watchEntry.key, ok: false, capped: true, nextBid, max });
      return;
    }

    const btn = S.findBidButton(cs);
    const input = S.findBidInput(cs);

    if (settings && settings.dryRun) {
      firedThisLoad = true;
      log(watchEntry, `[DRY RUN] Would bid $${nextBid} (max $${max}). Reason: ${reason}. ` +
        `Button found: ${!!btn}, input found: ${!!input}. Turn off Dry Run in the popup to bid for real.`);
      chrome.runtime.sendMessage({ type: "snipeResult", key: watchEntry.key, ok: true, dryRun: true, nextBid });
      notify(`DRY RUN: would have bid $${nextBid} on "${lot.title}"`);
      return;
    }

    if (!btn) {
      log(watchEntry, `FAILED (${reason}): bid button not found. Run Calibrate from the popup.`);
      chrome.runtime.sendMessage({ type: "snipeResult", key: watchEntry.key, ok: false, error: "no-button" });
      return;
    }

    firedThisLoad = true;
    if (input) {
      try { setNativeValue(input, String(nextBid)); } catch (_) {}
    }
    log(watchEntry, `BIDDING $${nextBid} now (${reason}).`);
    btn.click();

    // Many platforms pop a confirmation dialog — try to confirm it.
    setTimeout(confirmDialogIfAny, 350);
    setTimeout(confirmDialogIfAny, 900);

    chrome.runtime.sendMessage({ type: "snipeResult", key: watchEntry.key, ok: true, nextBid });
    notify(`Placed bid $${nextBid} on "${lot.title}"`);
  }

  function confirmDialogIfAny() {
    const cs = customSelectors();
    if (cs.confirmButton) {
      const c = document.querySelector(cs.confirmButton);
      if (c && S.visible(c)) { c.click(); return; }
    }
    const buttons = Array.from(document.querySelectorAll("button, input[type='submit'], input[type='button'], .btn, a[role='button']"));
    for (const b of buttons) {
      if (!S.visible(b)) continue;
      const t = (S.text(b) || b.value || "").toLowerCase();
      if (/\b(confirm|yes|place bid|ok|submit|i agree|continue)\b/.test(t)) { b.click(); return; }
    }
  }

  function notify(msg) {
    chrome.runtime.sendMessage({ type: "notify", title: "RL Spear Bid Assistant", message: msg });
  }

  // ---- calibration picker -------------------------------------------------
  let pickResolve = null;
  function startPicker(fieldLabel) {
    return new Promise((resolve) => {
      pickResolve = resolve;
      const overlay = document.createElement("div");
      overlay.id = "rlspear-pick-banner";
      overlay.textContent = `Calibrate: click the « ${fieldLabel} » on the page  (Esc to cancel)`;
      Object.assign(overlay.style, {
        position: "fixed", top: "0", left: "0", right: "0", zIndex: 2147483647,
        background: "#0b5", color: "#fff", font: "bold 14px system-ui",
        padding: "10px 14px", textAlign: "center", cursor: "crosshair"
      });
      document.documentElement.appendChild(overlay);

      const hi = document.createElement("div");
      Object.assign(hi.style, {
        position: "fixed", zIndex: 2147483646, background: "rgba(0,180,90,0.25)",
        border: "2px solid #0b5", pointerEvents: "none", display: "none"
      });
      document.documentElement.appendChild(hi);

      function move(e) {
        const el = e.target;
        if (!el || el === overlay) return;
        const r = el.getBoundingClientRect();
        Object.assign(hi.style, {
          display: "block", top: r.top + "px", left: r.left + "px",
          width: r.width + "px", height: r.height + "px"
        });
      }
      function click(e) {
        if (e.target === overlay) return;
        e.preventDefault();
        e.stopPropagation();
        const sel = S.buildSelector(e.target);
        cleanup();
        resolve({ selector: sel, sample: S.text(e.target).slice(0, 80) });
      }
      function key(e) { if (e.key === "Escape") { cleanup(); resolve(null); } }
      function cleanup() {
        document.removeEventListener("mousemove", move, true);
        document.removeEventListener("click", click, true);
        document.removeEventListener("keydown", key, true);
        overlay.remove(); hi.remove(); pickResolve = null;
      }
      document.addEventListener("mousemove", move, true);
      document.addEventListener("click", click, true);
      document.addEventListener("keydown", key, true);
    });
  }

  // ---- message handling ---------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "settings") {
      settings = msg.settings;
      return;
    }
    if (msg.type === "readLotNow") {
      sendResponse(readLot());
      return true;
    }
    if (msg.type === "pickElement") {
      startPicker(msg.label).then((res) => sendResponse(res));
      return true; // async
    }
    if (msg.type === "testBid") {
      // Force a (dry-run-respecting) bid attempt for testing from the popup.
      const lot = readLot();
      attemptBid(lot, "manual test from popup");
      sendResponse({ ok: true });
      return true;
    }
  });

  // ---- boot ---------------------------------------------------------------
  chrome.storage.local.get(["settings"], (data) => {
    settings = data.settings || {};
    startReporting();
  });
})();
