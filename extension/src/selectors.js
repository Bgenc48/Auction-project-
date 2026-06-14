/*
 * selectors.js — Maxanet (bid.rlspear.com) page reader
 * ----------------------------------------------------------------------------
 * Reads auction lots off the page. Tuned to the real Maxanet markup we
 * confirmed from the live page source:
 *
 *   • Each item exposes a hidden input  #AuctionItemId_<index>  (value = itemId)
 *     and bid fields  #BidAmount_<index>  and  #MaxBidAmount_<index>.
 *   • A live countdown element  .remain-time[data-enddate][data-currentdate]
 *     [data-auctionitemid]  gives exact end time + the server's "now" (so we
 *     can show time-left without trusting the local clock).
 *   • Win / outbid state is shown with tenant-styled classes:
 *        .public-winning-button-style   (you're the high bidder)
 *        .public-outbid-button-style    (you've been outbid)
 *   • Item titles live in  .auction-item-title  (or the nearest heading/link).
 *
 * Everything here is read-only. It also supports user-calibrated selectors as
 * an override, in case the markup differs in some view.
 * ----------------------------------------------------------------------------
 */

(function () {
  "use strict";

  function text(el) {
    return (el && (el.innerText || el.textContent) || "").trim();
  }
  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden";
  }
  function parseMoney(str) {
    if (str == null) return null;
    const m = String(str).replace(/[, ]/g, "").match(/\$?\s*([0-9]+(?:\.[0-9]+)?)/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    return Number.isFinite(n) ? n : null;
  }

  function parseDateLoose(str) {
    if (!str) return null;
    // Maxanet's CountDown does: new Date(str.replace(/-/g, "/"))
    const d = new Date(String(str).replace(/-/g, "/"));
    return isNaN(d.getTime()) ? null : d;
  }

  // Find the card (container) that wraps one item, starting from any element
  // known to belong to it. Walks up until the ancestor also contains a title
  // or a status button — i.e. looks like a whole item card.
  function findCard(startEl) {
    let node = startEl;
    for (let i = 0; node && node.nodeType === 1 && i < 9; i++) {
      if (
        node.querySelector &&
        (node.querySelector(".auction-item-title") ||
          node.querySelector(".public-winning-button-style, .public-outbid-button-style") ||
          node.querySelector(".remain-time"))
      ) {
        // Make sure it's not the whole page wrapper (must be reasonably small).
        const items = node.querySelectorAll('input[id^="AuctionItemId_"]');
        if (items.length <= 1) return node;
      }
      node = node.parentElement;
    }
    return startEl ? startEl.parentElement : null;
  }

  function statusFromCard(card) {
    if (!card) return "none";
    if (card.querySelector(".public-winning-button-style")) return "winning";
    if (card.querySelector(".public-outbid-button-style")) return "outbid";
    // Text fallback
    const t = text(card).toLowerCase();
    if (/high bidder|you'?re winning|winning/.test(t)) return "winning";
    if (/outbid/.test(t)) return "outbid";
    return "none";
  }

  function titleFromCard(card) {
    if (!card) return "";
    const t = card.querySelector(".auction-item-title");
    if (t && text(t)) return text(t);
    const link = card.querySelector('a[href*="AuctionItemDetail"], a[href*="ItemDetail"]');
    if (link && text(link)) return text(link);
    const h = card.querySelector("h1,h2,h3,h4,.item-title");
    if (h && text(h)) return text(h);
    return "";
  }

  function currentBidFromCard(card) {
    if (!card) return null;
    // Prefer an explicit "current bid" labelled area.
    const labelled = Array.from(card.querySelectorAll("span,div,p,td,strong,b")).filter((el) => {
      const t = text(el).toLowerCase();
      return /\$/.test(text(el)) && /(current|high)\s*bid/.test(t);
    });
    if (labelled.length) return parseMoney(text(labelled[0]));
    // Else the bid amount input's placeholder/value often holds the next bid.
    const bidInput = card.querySelector('input[id^="BidAmount_"]');
    if (bidInput && (bidInput.value || bidInput.placeholder)) {
      const v = parseMoney(bidInput.value) || parseMoney(bidInput.placeholder);
      if (v != null) return v;
    }
    // Else the first $ amount in the card — but skip the title, which usually
    // embeds a "Retail $…" that would otherwise be misread as the current bid.
    const titleEl = card.querySelector(".auction-item-title");
    const any = Array.from(card.querySelectorAll("span,div,p,td,strong,b")).find((el) => {
      if (titleEl && (el === titleEl || titleEl.contains(el))) return false;
      return /\$/.test(text(el));
    });
    return any ? parseMoney(text(any)) : null;
  }

  function timeFromCard(card) {
    if (!card) return { endMs: null, serverNowMs: null };
    const timer = card.querySelector(".remain-time[data-enddate]") || card.querySelector("[data-enddate]");
    if (!timer) return { endMs: null, serverNowMs: null };
    const end = parseDateLoose(timer.getAttribute("data-enddate"));
    const cur = parseDateLoose(timer.getAttribute("data-currentdate"));
    return {
      endMs: end ? end.getTime() : null,
      serverNowMs: cur ? cur.getTime() : null
    };
  }

  function indexFromInput(input) {
    const m = (input.id || "").match(/_(\d+)$/);
    return m ? m[1] : null;
  }

  // Scan a page (or a parsed document from GetAuctionItems) and return an
  // array of item snapshots. `root` defaults to the live document.
  function scanItems(root) {
    root = root || document;
    const out = [];
    const seen = new Set();
    const idInputs = Array.from(root.querySelectorAll('input[id^="AuctionItemId_"]'));

    const handle = (card, itemId, index) => {
      if (!itemId || seen.has(itemId)) return;
      seen.add(itemId);
      const maxField = index && root.getElementById ? root.getElementById("MaxBidAmount_" + index) : null;
      const t = timeFromCard(card);
      const title = titleFromCard(card);
      out.push({
        id: String(itemId),
        index: index || null,
        title,
        currentBid: currentBidFromCard(card),
        myMaxBid: maxField ? parseMoney(maxField.value) : null,
        status: statusFromCard(card),
        endMs: t.endMs,
        serverNowMs: t.serverNowMs,
        value: parseTitleValue(title),
        capturedAt: Date.now(),
        url: bestUrlForCard(card)
      });
    };

    if (idInputs.length) {
      for (const input of idInputs) {
        handle(findCard(input), input.value, indexFromInput(input));
      }
    } else {
      // Fallback: enumerate by timer elements (each carries data-auctionitemid).
      const timers = Array.from(root.querySelectorAll(".remain-time[data-auctionitemid], [data-auctionitemid][data-enddate]"));
      for (const timer of timers) {
        const itemId = timer.getAttribute("data-auctionitemid");
        handle(findCard(timer), itemId, null);
      }
    }
    return out;
  }

  // ---- value engine -------------------------------------------------------
  // The lot title is the richest signal — it usually embeds retail price,
  // condition and quantity. Parse it so we can rank lots by real discount.
  function parseTitleValue(title) {
    if (!title) return {};
    const retailM = title.match(/(?:retail|msrp|value|orig(?:inal)?(?:\s*price)?)\s*[:\-]?\s*\$\s*([\d,]+(?:\.\d{1,2})?)/i)
      || title.match(/\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:retail|msrp|value)/i);
    const condM = title.match(/\b(brand new|new in box|like new|open box|showroom sample|refurbished|gently used|used|new|damaged)\b/i);
    const qtyM = title.match(/(?:qty[:\s]*|set of\s*|\(\s*|x\s*)?(\d+)\s*(?:each|ea\b|pcs|pieces|units|count|ct\b)/i);
    return {
      retail: retailM ? parseFloat(retailM[1].replace(/,/g, "")) : null,
      condition: condM ? condM[1] : null,
      qty: qtyM ? parseInt(qtyM[1], 10) : null
    };
  }

  // All-in cost vs retail. premiumPct = buyer's premium (rlspear = 13%).
  function valuation(currentBid, retail, premiumPct) {
    if (retail == null || retail <= 0) return null;
    const bid = currentBid != null ? currentBid : 0;
    const allIn = bid * (1 + (premiumPct || 0) / 100);
    return {
      retail,
      allIn: Math.round(allIn * 100) / 100,
      discountPct: Math.round((1 - allIn / retail) * 100)
    };
  }

  function bestUrlForCard(card) {
    const link = card && card.querySelector('a[href*="AuctionItemDetail"], a[href*="ItemDetail"], a[href*="AuctionItems"]');
    const raw = link && link.getAttribute("href");
    if (raw) {
      try { return new URL(raw, location.href).href; } catch (_) {}
    }
    return location.href;
  }

  function auctionIdFromPage() {
    const el = document.getElementById("hdn_AuctionId");
    return el ? el.value : null;
  }

  // Robust-ish CSS selector for calibration clicks.
  function buildSelector(el) {
    if (!el) return null;
    if (el.id) return "#" + CSS.escape(el.id);
    const parts = [];
    let node = el, depth = 0;
    while (node && node.nodeType === 1 && depth < 5) {
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift("#" + CSS.escape(node.id)); break; }
      const cls = Array.from(node.classList || []).filter((c) => c && !/\d{3,}/.test(c) && c.length < 40);
      if (cls.length) part += "." + CSS.escape(cls[0]);
      const parent = node.parentNode;
      if (parent) {
        const same = Array.from(parent.children).filter((s) => s.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = node.parentElement; depth++;
    }
    return parts.join(" > ");
  }

  window.RLSpearSelectors = {
    scanItems,
    parseTitleValue,
    valuation,
    auctionIdFromPage,
    parseMoney,
    buildSelector,
    text,
    visible
  };
})();
