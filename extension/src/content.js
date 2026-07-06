/*
 * content.js — runs on every bid.rlspear.com page.
 * Scans the lots on the page, watches for live changes (Maxanet re-renders an
 * item card the instant a bid lands), and reports snapshots to the background
 * worker which drives the dashboard and outbid alerts.
 *
 * It does NOT place bids. The winning strategy on this platform is the site's
 * own Max Bid (proxy) field — so the most this script does is, on request,
 * pre-fill the Max Bid box and scroll to it so you can review and submit.
 */

(function () {
  "use strict";

  const S = window.RLSpearSelectors;
  if (!S) return;

  let lastSig = "";
  let scanTimer = null;
  let observer = null;

  function report(reason) {
    let items = [];
    try { items = S.scanItems(); } catch (e) { return; }
    const payload = {
      type: "pageItems",
      url: location.href,
      host: location.host,
      auctionId: S.auctionIdFromPage(),
      items,
      reason,
      at: Date.now()
    };
    // Only message when something actually changed (keeps it cheap). Include
    // endMs so a Dynamic-Closing time extension still propagates to the
    // background even if bid/status happen to look unchanged in this snapshot.
    const sig = JSON.stringify(items.map((i) => [i.id, i.currentBid, i.status, i.myMaxBid, i.endMs]));
    if (sig === lastSig && reason !== "force") return;
    lastSig = sig;
    chrome.runtime.sendMessage(payload, () => void chrome.runtime.lastError);
    ensurePubnub(); // (re)subscribe if the set of lots on the page changed
  }

  function startObserving() {
    // Rescan when the item list re-renders (Maxanet swaps an item's markup when
    // a bid lands). We intentionally do NOT watch characterData, because the
    // 1-second countdown timers would otherwise fire this constantly.
    observer = new MutationObserver(() => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => report("mutation"), 600);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Safety net: a slow heartbeat in case a mutation is missed.
    setInterval(() => report("poll"), 5000);
    report("force");
  }

  // ---- pre-fill the native Max Bid field (review-only, never submits) -------
  function prefillMax(itemId, amount) {
    const items = S.scanItems();
    const it = items.find((i) => String(i.id) === String(itemId));
    if (!it || !it.index) return { ok: false, error: "item-not-on-page" };
    const field = document.getElementById("MaxBidAmount_" + it.index);
    if (!field) return { ok: false, error: "no-maxbid-field" };
    const proto = HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(field, String(amount));
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.scrollIntoView({ behavior: "smooth", block: "center" });
    field.style.outline = "3px solid #19b36b";
    setTimeout(() => (field.style.outline = ""), 4000);
    return { ok: true };
  }

  // ---- calibration picker (fallback if a view differs) ----------------------
  function startPicker(label) {
    return new Promise((resolve) => {
      const banner = document.createElement("div");
      banner.textContent = `Click the « ${label} » on the page (Esc to cancel)`;
      Object.assign(banner.style, {
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 2147483647,
        background: "#19b36b", color: "#fff", font: "bold 14px system-ui",
        padding: "10px", textAlign: "center"
      });
      document.documentElement.appendChild(banner);
      function click(e) {
        if (e.target === banner) return;
        e.preventDefault(); e.stopPropagation();
        const sel = S.buildSelector(e.target);
        cleanup(); resolve({ selector: sel, sample: S.text(e.target).slice(0, 80) });
      }
      function key(e) { if (e.key === "Escape") { cleanup(); resolve(null); } }
      function cleanup() {
        document.removeEventListener("click", click, true);
        document.removeEventListener("keydown", key, true);
        banner.remove();
      }
      document.addEventListener("click", click, true);
      document.addEventListener("keydown", key, true);
    });
  }

  // ---- sweep the whole auction via the site's own GetAuctionItems endpoint --
  async function scanAllPages(maxPages) {
    // Default high enough to cover a full 1,500+ item auction; the loop below
    // stops early as soon as a page returns no new lots, so this is just a cap.
    maxPages = maxPages || 60;
    let base = null;
    try { base = JSON.parse(localStorage.getItem("AuctionItemData") || "null"); } catch (_) {}
    if (!base || !base.aucId) return { ok: false, error: "open-auction-list-first" };

    const all = [];
    const seen = new Set();
    let pages = 0;
    for (let p = 1; p <= maxPages; p++) {
      const merged = Object.assign({}, base, { pageNumber: String(p), oldPageNumber: "", _: String(Date.now()) });
      // Match jQuery's serialization: null/undefined are sent as empty strings,
      // not the literal "null"/"undefined" that URLSearchParams would produce.
      const params = {};
      for (const k of Object.keys(merged)) params[k] = merged[k] == null ? "" : merged[k];
      let html;
      try {
        const res = await fetch("/Public/Auction/GetAuctionItems?" + new URLSearchParams(params).toString(), {
          credentials: "include",
          headers: { "X-Requested-With": "XMLHttpRequest" }
        });
        html = await res.text();
      } catch (e) { break; }
      if (!html || html.trim() === "true") break; // session/redirect signal
      const doc = new DOMParser().parseFromString(html, "text/html");
      const items = S.scanItems(doc);
      if (!items.length) break;
      let added = 0;
      for (const it of items) { if (!seen.has(it.id)) { seen.add(it.id); all.push(it); added++; } }
      pages = p;
      if (added === 0) break; // looping the same page → done
      await new Promise((r) => setTimeout(r, 250)); // be polite to the server
    }
    return { ok: true, items: all, pages };
  }

  // ---- debug: capture one lot card's raw HTML so selectors can be tuned ------
  // Returns the outerHTML of a real item card plus what the reader parsed from
  // it, so a mismatch on the live site can be turned into a regression fixture.
  function captureCard(itemId) {
    const inputs = Array.from(document.querySelectorAll('input[id^="AuctionItemId_"]'));
    let input = itemId ? inputs.find((i) => String(i.value) === String(itemId)) : null;
    input = input || inputs[0];
    if (!input) return { ok: false, error: "no-items-on-page" };
    let card = input;
    for (let node = input, hops = 0; node && node.nodeType === 1 && hops < 9; hops++, node = node.parentElement) {
      const looksLikeCard = node.querySelector && (
        node.querySelector(".auction-item-title") ||
        node.querySelector(".public-winning-button-style, .public-outbid-button-style") ||
        node.querySelector(".remain-time"));
      if (looksLikeCard && node.querySelectorAll('input[id^="AuctionItemId_"]').length <= 1) { card = node; break; }
    }
    const snapshot = S.scanItems().find((i) => String(i.id) === String(input.value)) || null;
    return { ok: true, id: input.value, html: (card.outerHTML || "").slice(0, 20000), snapshot };
  }

  // ---- optional PubNub real-time (opt-in; off by default) -------------------
  // Maxanet pushes bid updates over PubNub. The site's own JS already re-renders
  // cards on those messages (our MutationObserver catches that), so this is a
  // latency optimisation: when enabled, a push triggers an immediate rescan
  // instead of waiting for the DOM debounce. Dependency-free long-poll against
  // PubNub's subscribe REST endpoint — no SDK, no keys stored.
  let pubnubEnabled = false;
  let pnController = null;
  let pnChannelsSig = "";

  function findSubKey() {
    const html = document.documentElement ? document.documentElement.innerHTML : "";
    const m = html.match(/sub-c-[0-9a-zA-Z-]{10,}/); // PubNub subscribe key form
    return m ? m[0] : null;
  }

  function pubnubChannels() {
    const chans = new Set();
    const aId = S.auctionIdFromPage();
    if (aId) { chans.add("bid_groupitem_refresh" + aId); chans.add("auction_halt" + aId); }
    try { for (const it of S.scanItems()) if (it.id) chans.add("bid_refresh" + it.id); } catch (_) {}
    return Array.from(chans).sort();
  }

  async function pubnubLoop(subKey, channels, controller) {
    let tt = "0";
    const uuid = "rlspear-helper-" + Math.random().toString(36).slice(2, 10);
    const chanPath = encodeURIComponent(channels.join(","));
    while (!controller.signal.aborted) {
      const url = `https://ps.pndsn.com/subscribe/${subKey}/${chanPath}/0/${tt}?uuid=${uuid}`;
      let data;
      try {
        const res = await fetch(url, { signal: controller.signal });
        data = await res.json();
      } catch (e) {
        if (controller.signal.aborted) return;
        await new Promise((r) => setTimeout(r, 5000)); // back off, then retry
        continue;
      }
      tt = (data && data[1]) || tt; // PubNub reply: [ [messages], timetoken ]
      const msgs = (data && data[0]) || [];
      if (msgs.length) { clearTimeout(scanTimer); scanTimer = setTimeout(() => report("pubnub"), 150); }
    }
  }

  function ensurePubnub() {
    if (!pubnubEnabled) return;
    const channels = pubnubChannels();
    const sig = channels.join(",");
    if (sig === pnChannelsSig) return; // already subscribed to this exact set
    if (pnController) pnController.abort();
    if (!channels.length) { pnController = null; pnChannelsSig = ""; return; }
    const subKey = findSubKey();
    if (!subKey) return; // no key on this page → stay on the DOM path
    pnChannelsSig = sig;
    pnController = new AbortController();
    pubnubLoop(subKey, channels, pnController);
  }

  function stopPubnub() {
    if (pnController) pnController.abort();
    pnController = null;
    pnChannelsSig = "";
  }

  // ---- keep the session alive during long monitoring ------------------------
  function keepAlive() {
    fetch("/Public/Login/KeepSessionAlive", {
      credentials: "include",
      headers: { "X-Requested-With": "XMLHttpRequest" }
    }).catch(() => {});
  }
  setInterval(keepAlive, 4 * 60 * 1000);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "readItemsNow") {
      sendResponse({ items: S.scanItems(), url: location.href, auctionId: S.auctionIdFromPage() });
      return true;
    }
    if (msg.type === "scanAll") {
      scanAllPages(msg.maxPages).then(sendResponse);
      return true;
    }
    if (msg.type === "prefillMax") {
      sendResponse(prefillMax(msg.itemId, msg.amount));
      return true;
    }
    if (msg.type === "pickElement") {
      startPicker(msg.label).then(sendResponse);
      return true;
    }
    if (msg.type === "captureCard") {
      sendResponse(captureCard(msg.itemId));
      return true;
    }
    if (msg.type === "settingsChanged") {
      const want = !!(msg.settings && msg.settings.pubnubRealtime);
      if (want && !pubnubEnabled) { pubnubEnabled = true; ensurePubnub(); }
      else if (!want && pubnubEnabled) { pubnubEnabled = false; stopPubnub(); }
      return; // no response needed
    }
  });

  // Pick up the user's PubNub preference (opt-in) once at startup.
  chrome.runtime.sendMessage({ type: "getState" }, (state) => {
    if (chrome.runtime.lastError || !state) return;
    pubnubEnabled = !!(state.settings && state.settings.pubnubRealtime);
    if (pubnubEnabled) ensurePubnub();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserving);
  } else {
    startObserving();
  }
})();
