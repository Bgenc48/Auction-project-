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
    // Only message when something actually changed (keeps it cheap).
    const sig = JSON.stringify(items.map((i) => [i.id, i.currentBid, i.status, i.myMaxBid]));
    if (sig === lastSig && reason !== "force") return;
    lastSig = sig;
    chrome.runtime.sendMessage(payload, () => void chrome.runtime.lastError);
  }

  function startObserving() {
    // Debounced rescan whenever the DOM changes (covers PubNub-driven updates).
    observer = new MutationObserver(() => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => report("mutation"), 400);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
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

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "readItemsNow") {
      sendResponse({ items: S.scanItems(), url: location.href, auctionId: S.auctionIdFromPage() });
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
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserving);
  } else {
    startObserving();
  }
})();
