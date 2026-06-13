/*
 * selectors.js
 * ----------------------------------------------------------------------------
 * Knows how to FIND the important things on an rlspear lot page:
 *   - lot title
 *   - current price
 *   - time remaining / close time
 *   - the bid button (and optional bid amount / max-bid input)
 *   - whether YOU are currently the high bidder
 *
 * Because the live site can't be inspected ahead of time, this file provides:
 *   1. Heuristic auto-detection (best effort, works without setup).
 *   2. Support for user-calibrated CSS selectors (set via the popup's
 *      "Calibrate" picker) which always take priority over the heuristics.
 *
 * Everything here is pure DOM reading — it never clicks or types.
 * ----------------------------------------------------------------------------
 */

(function () {
  "use strict";

  const WINNING_WORDS = [
    "you're the high bidder",
    "you are the high bidder",
    "you are winning",
    "you're winning",
    "high bidder: you",
    "winning bid is yours",
    "you have the high bid"
  ];
  const OUTBID_WORDS = [
    "you've been outbid",
    "you have been outbid",
    "you are outbid",
    "outbid",
    "you were outbid",
    "not the high bidder"
  ];

  function text(el) {
    return (el && (el.innerText || el.textContent) || "").trim();
  }

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
  }

  function queryCalibrated(sel) {
    if (!sel) return null;
    try {
      const el = document.querySelector(sel);
      if (el && visible(el)) return el;
    } catch (_) {}
    return null;
  }

  // Parse the first money value out of a string -> number (e.g. "$1,250.00" -> 1250)
  function parseMoney(str) {
    if (!str) return null;
    const m = String(str).replace(/[, ]/g, "").match(/\$?\s*([0-9]+(?:\.[0-9]+)?)/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    return Number.isFinite(n) ? n : null;
  }

  // ---- Title --------------------------------------------------------------
  function findTitle(custom) {
    const c = queryCalibrated(custom && custom.title);
    if (c) return text(c);
    const h = document.querySelector("h1, h2, .lot-title, .item-title, [class*='title']");
    if (h && text(h)) return text(h);
    return (document.title || "").replace(/\s*[-|–].*$/, "").trim() || document.title;
  }

  // ---- Current price ------------------------------------------------------
  function findCurrentPriceEl(custom) {
    const c = queryCalibrated(custom && custom.currentPrice);
    if (c) return c;

    // Heuristic: an element whose nearby label mentions "current"/"high bid"
    // and that contains a $ amount.
    const candidates = Array.from(
      document.querySelectorAll(
        "[class*='current'],[class*='bid'],[id*='current'],[id*='bid'],span,div,td"
      )
    );
    let best = null;
    for (const el of candidates) {
      if (!visible(el)) continue;
      const t = text(el);
      if (!/\$/.test(t)) continue;
      const lower = (t + " " + (el.className || "") + " " + (el.id || "")).toLowerCase();
      if (/(current|high\s*bid|winning\s*bid|current\s*bid|bid\s*amount)/.test(lower)) {
        // Prefer the shortest text that still has a price (most specific).
        if (!best || t.length < text(best).length) best = el;
      }
    }
    return best;
  }

  function findCurrentPrice(custom) {
    const el = findCurrentPriceEl(custom);
    return el ? parseMoney(text(el)) : null;
  }

  // ---- Time remaining / close time ---------------------------------------
  function findTimeEl(custom) {
    const c = queryCalibrated(custom && custom.timeLeft);
    if (c) return c;
    const els = Array.from(document.querySelectorAll("[class*='time'],[class*='count'],[id*='time'],[id*='count'],span,div"));
    for (const el of els) {
      if (!visible(el)) continue;
      const t = text(el);
      // matches "1d 02:03:45", "02:03:45", "12:34", "3 minutes" etc.
      if (/\b\d{1,2}:\d{2}(:\d{2})?\b/.test(t) || /\b\d+\s*(day|hour|min|sec)/i.test(t)) {
        const lower = (t + " " + (el.className || "") + " " + (el.id || "")).toLowerCase();
        if (/(time|left|remain|count|clos|ends?)/.test(lower)) return el;
      }
    }
    return null;
  }

  // Returns seconds remaining (number) or null if unknown.
  function findSecondsLeft(custom) {
    const el = findTimeEl(custom);
    if (!el) return null;
    return parseDurationToSeconds(text(el));
  }

  function parseDurationToSeconds(str) {
    if (!str) return null;
    str = String(str).toLowerCase();

    // Format A: "1d 02:03:45" / "02:03:45" / "03:45"
    const clock = str.match(/(?:(\d+)\s*d[ay]*\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (clock) {
      const days = parseInt(clock[1] || "0", 10);
      const a = parseInt(clock[2], 10);
      const b = parseInt(clock[3], 10);
      const c = clock[4] != null ? parseInt(clock[4], 10) : null;
      let secs;
      if (c != null) secs = a * 3600 + b * 60 + c; // hh:mm:ss
      else secs = a * 60 + b; // mm:ss
      return days * 86400 + secs;
    }

    // Format B: "1 day 2 hours 3 min 4 sec"
    let total = 0;
    let matched = false;
    const units = [
      [/(\d+)\s*d/, 86400],
      [/(\d+)\s*h/, 3600],
      [/(\d+)\s*m(?!o)/, 60],
      [/(\d+)\s*s/, 1]
    ];
    for (const [re, mult] of units) {
      const m = str.match(re);
      if (m) {
        total += parseInt(m[1], 10) * mult;
        matched = true;
      }
    }
    return matched ? total : null;
  }

  // ---- Bid controls -------------------------------------------------------
  function findBidButton(custom) {
    const c = queryCalibrated(custom && custom.bidButton);
    if (c) return c;
    const buttons = Array.from(
      document.querySelectorAll("button, input[type='submit'], input[type='button'], a.btn, a[role='button'], .btn")
    );
    for (const b of buttons) {
      if (!visible(b)) continue;
      const label = (text(b) || b.value || b.getAttribute("aria-label") || "").toLowerCase();
      if (/\b(place\s*bid|bid\s*now|submit\s*bid|confirm\s*bid|^bid$|place a bid)\b/.test(label)) {
        if (b.disabled) continue;
        return b;
      }
    }
    return null;
  }

  function findBidInput(custom) {
    const c = queryCalibrated(custom && custom.bidInput);
    if (c) return c;
    const inputs = Array.from(document.querySelectorAll("input[type='text'], input[type='number'], input:not([type])"));
    for (const inp of inputs) {
      if (!visible(inp)) continue;
      const hay = ((inp.name || "") + " " + (inp.id || "") + " " + (inp.placeholder || "") + " " + (inp.className || "")).toLowerCase();
      if (/(bid|amount|offer)/.test(hay)) return inp;
    }
    return null;
  }

  function findMaxBidInput(custom) {
    // Optional: some platforms have a native "max bid / proxy bid" field.
    return queryCalibrated(custom && custom.maxBidInput);
  }

  // ---- Am I winning? ------------------------------------------------------
  function findStatus(custom) {
    // Returns "winning" | "outbid" | "unknown"
    let scope = document.body;
    const c = queryCalibrated(custom && custom.status);
    if (c) scope = c;
    const haystack = text(scope).toLowerCase();

    const extraWin = (custom && custom.winningKeywords) || [];
    const extraOut = (custom && custom.outbidKeywords) || [];

    for (const w of WINNING_WORDS.concat(extraWin)) {
      if (w && haystack.includes(w.toLowerCase())) return "winning";
    }
    for (const w of OUTBID_WORDS.concat(extraOut)) {
      if (w && haystack.includes(w.toLowerCase())) return "outbid";
    }
    return "unknown";
  }

  // Build a reasonably stable CSS selector for a clicked element (calibration).
  function buildSelector(el) {
    if (!el) return null;
    if (el.id) return "#" + CSS.escape(el.id);

    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 5) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift("#" + CSS.escape(node.id));
        break;
      }
      // Use a stable-looking class if present (skip dynamic/hash-y ones).
      const cls = Array.from(node.classList || []).filter(
        (c) => c && !/\d{3,}/.test(c) && c.length < 40
      );
      if (cls.length) part += "." + CSS.escape(cls[0]);

      // Disambiguate among siblings.
      const parent = node.parentNode;
      if (parent) {
        const same = Array.from(parent.children).filter(
          (s) => s.tagName === node.tagName
        );
        if (same.length > 1) {
          part += `:nth-of-type(${same.indexOf(node) + 1})`;
        }
      }
      parts.unshift(part);
      node = node.parentNode;
      depth++;
    }
    return parts.join(" > ");
  }

  // Identify the lot from the URL (rlspear uses AuctionId / LotId query params).
  function lotKeyFromUrl(href) {
    try {
      const u = new URL(href || location.href);
      const a = u.searchParams.get("AuctionId") || "";
      const l =
        u.searchParams.get("LotId") ||
        u.searchParams.get("ItemId") ||
        u.searchParams.get("lotId") ||
        "";
      const base = u.origin + u.pathname;
      const id = (a + "|" + l).replace(/\s/g, "");
      return id.replace(/[|]+$/g, "") ? base + "?" + id : base + u.search;
    } catch (_) {
      return href || location.href;
    }
  }

  window.RLSpearSelectors = {
    parseMoney,
    parseDurationToSeconds,
    findTitle,
    findCurrentPrice,
    findCurrentPriceEl,
    findSecondsLeft,
    findTimeEl,
    findBidButton,
    findBidInput,
    findMaxBidInput,
    findStatus,
    buildSelector,
    lotKeyFromUrl,
    visible,
    text
  };
})();
