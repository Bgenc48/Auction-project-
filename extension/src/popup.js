/* popup.js — dashboard for tracking lots, alerts, and Max-Bid help. */
"use strict";

const $ = (s) => document.querySelector(s);
let state = { tracked: {}, settings: {} };
let activeTab = null;
let pageItems = [];

function money(n) { return n == null ? "—" : "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function timeLeft(epoch) {
  if (!epoch) return "—";
  let s = Math.floor((epoch - Date.now()) / 1000);
  if (s <= 0) return "closed";
  const d = Math.floor(s / 86400); s %= 86400;
  const h = Math.floor(s / 3600); s %= 3600;
  const m = Math.floor(s / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}
function esc(s) { return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function statusPill(s) {
  if (s === "winning") return `<span class="pill win">Winning</span>`;
  if (s === "outbid") return `<span class="pill lose">Outbid</span>`;
  return `<span class="pill mode">no bid</span>`;
}
function premium() { return (state.settings && state.settings.premiumPct) || 0; }
// Returns a value badge HTML for an item that carries a parsed `value` (retail).
function valueBadge(currentBid, value) {
  const retail = value && value.retail;
  if (!retail) return "";
  const v = window.RLSpearSelectors.valuation(currentBid, retail, premium());
  if (!v) return "";
  const cls = v.discountPct >= 60 ? "win" : v.discountPct >= 30 ? "" : "lose";
  return `<span class="pill ${cls}" title="Retail $${retail} · all-in ~$${v.allIn} (incl. ${premium()}% premium)">${v.discountPct}% off</span>`;
}
function send(msg) { return new Promise((r) => chrome.runtime.sendMessage(msg, (x) => r(x))); }
function tabSend(id, msg) {
  return new Promise((r) => chrome.tabs.sendMessage(id, msg, (x) => r(chrome.runtime.lastError ? null : x)));
}

async function refresh() {
  state = await send({ type: "getState" });
  const s = state.settings || {};
  $("#outbidAlerts").checked = !!s.outbidAlerts;
  $("#endingSoonAlerts").checked = !!s.endingSoonAlerts;
  $("#endingSoonLeadMin").value = s.endingSoonLeadMin || 10;
  $("#premiumPct").value = s.premiumPct != null ? s.premiumPct : 13;
  renderTracked();
}

function renderTracked() {
  const t = state.tracked || {};
  const keys = Object.keys(t).sort((a, b) => (t[a].endEpoch || Infinity) - (t[b].endEpoch || Infinity));
  $("#trackedCount").textContent = keys.length ? `${keys.length} lot${keys.length > 1 ? "s" : ""}` : "";
  const root = $("#tracked");
  if (!keys.length) {
    root.innerHTML = `<div class="muted small">No lots yet. Open the auction, expand "Add lots from this page", and Track the ones you want.</div>`;
    return;
  }
  root.innerHTML = keys.map((id) => {
    const e = t[id];
    const overMax = e.currentBid != null && e.targetMax && e.currentBid >= e.targetMax;
    return `<div class="lot ${e.lastStatus === "outbid" ? "alert" : ""}" data-id="${esc(id)}">
      <div class="t" title="${esc(e.title)}">${esc(e.title || "(lot " + id + ")")}</div>
      <div class="meta">
        <span>now ${money(e.currentBid)}</span>
        <span>max ${money(e.myMaxBid)}</span>
        <span class="tl" data-end="${e.endEpoch || ""}">${timeLeft(e.endEpoch)}</span>
        ${statusPill(e.lastStatus)}
        ${valueBadge(e.currentBid, e.value)}
        ${overMax ? `<span class="pill cap">past your target</span>` : ""}
      </div>
      <div class="meta">
        <label class="tgt">Target&nbsp;$<input type="number" min="0" class="target" value="${e.targetMax ?? ""}" placeholder="—" /></label>
        <a class="link setmax" href="#" title="Fill the site's Max Bid box with your target (you still click Bid)">Put on page</a>
        <a class="link comps" href="#">eBay $</a>
        <a class="link open" href="#">Open</a>
        <a class="link remove" href="#">✕</a>
      </div>
    </div>`;
  }).join("");

  root.querySelectorAll(".lot").forEach((row) => {
    const id = row.dataset.id;
    const e = t[id];
    row.querySelector(".target").addEventListener("change", (ev) => {
      send({ type: "setTarget", id, targetMax: parseFloat(ev.target.value) || null });
    });
    row.querySelector(".open").addEventListener("click", (ev) => { ev.preventDefault(); chrome.tabs.create({ url: e.url }); });
    row.querySelector(".comps").addEventListener("click", (ev) => { ev.preventDefault(); openComps(e.title); });
    row.querySelector(".remove").addEventListener("click", async (ev) => { ev.preventDefault(); await send({ type: "untrack", id }); refresh(); });
    row.querySelector(".setmax").addEventListener("click", async (ev) => {
      ev.preventDefault();
      const amount = parseFloat(row.querySelector(".target").value);
      if (!amount) { alert("Set a Target $ first."); return; }
      if (!activeTab) { alert("Open the lot's page in a tab first, then try again."); return; }
      const res = await tabSend(activeTab.id, { type: "prefillMax", itemId: id, amount });
      if (!res || !res.ok) alert("Couldn't find that lot's Max Bid box on the current tab. Open the lot's page (or detail page) and try again.\n\n(" + (res && res.error) + ")");
    });
  });
}

// Tick the tracked-lot countdowns once a second (the popup is short-lived, so
// the interval dies with it). Flags lots inside the final 5 min as urgent.
let ticker = null;
function startTicker() {
  if (ticker) clearInterval(ticker);
  ticker = setInterval(() => {
    document.querySelectorAll(".tl[data-end]").forEach((el) => {
      const ep = parseInt(el.dataset.end, 10) || null;
      el.textContent = timeLeft(ep);
      el.classList.toggle("urgent", !!ep && ep - Date.now() > 0 && ep - Date.now() <= 5 * 60000);
    });
  }, 1000);
}

function openComps(title) {
  const url = "https://www.ebay.com/sch/i.html?_nkw=" + encodeURIComponent(title || "") + "&LH_Sold=1&LH_Complete=1&_sop=13";
  chrome.tabs.create({ url });
}

async function loadPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab && /rlspear\.com/.test(tab.url || "") ? tab : null;
  const root = $("#pageItems");
  if (!activeTab) { root.innerHTML = `<div class="muted small">Open the rlspear auction in this tab to list its lots here.</div>`; return; }
  const resp = await tabSend(activeTab.id, { type: "readItemsNow" });
  pageItems = (resp && resp.items) || [];
  if (!pageItems.length) {
    root.innerHTML = `<div class="muted small">No lots detected on this page yet. Wait for it to finish loading, or open a single lot's detail page.</div>`;
    return;
  }
  root.innerHTML = pageItems.slice(0, 60).map((it) => `
    <div class="pitem" data-id="${esc(it.id)}">
      <div class="t" title="${esc(it.title)}">${esc(it.title || "(lot " + it.id + ")")}</div>
      <div class="meta">
        <span>now ${money(it.currentBid)}</span>
        ${statusPill(it.status)}
        ${valueBadge(it.currentBid, it.value)}
        <a class="link track" href="#">${state.tracked[it.id] ? "Tracked ✓" : "Track"}</a>
      </div>
    </div>`).join("") + (pageItems.length > 60 ? `<div class="muted small">+${pageItems.length - 60} more — search/filter on the site to narrow them.</div>` : "");

  root.querySelectorAll(".pitem").forEach((row) => {
    const it = pageItems.find((x) => String(x.id) === row.dataset.id);
    row.querySelector(".track").addEventListener("click", async (ev) => {
      ev.preventDefault();
      await send({ type: "track", item: it });
      await refresh();
      ev.target.textContent = "Tracked ✓";
    });
  });
}

// ---- best-value finder ----------------------------------------------------
function renderValueResults(items) {
  const root = $("#valueResults");
  const ranked = items
    .map((it) => ({ it, v: window.RLSpearSelectors.valuation(it.currentBid, it.value && it.value.retail, premium()) }))
    .filter((x) => x.v)
    .sort((a, b) => b.v.discountPct - a.v.discountPct)
    .slice(0, 40);
  if (!ranked.length) {
    root.innerHTML = `<div class="muted small">No lots with a "Retail $…" in the title were found to rank.</div>`;
    return;
  }
  root.innerHTML = ranked.map(({ it, v }) => `
    <div class="pitem" data-id="${esc(it.id)}">
      <div class="t" title="${esc(it.title)}">${esc(it.title || "(lot " + it.id + ")")}</div>
      <div class="meta">
        <span class="pill ${v.discountPct >= 60 ? "win" : v.discountPct >= 30 ? "mode" : "lose"}">${v.discountPct}% off</span>
        <span>now ${money(it.currentBid)} → ~${money(v.allIn)} all-in</span>
        <span>retail ${money(v.retail)}</span>
        <a class="link track" href="#">${state.tracked[it.id] ? "Tracked ✓" : "Track"}</a>
        <a class="link comps" href="#">eBay $</a>
      </div>
    </div>`).join("");
  root.querySelectorAll(".pitem").forEach((row) => {
    const it = items.find((x) => String(x.id) === row.dataset.id);
    row.querySelector(".track").addEventListener("click", async (ev) => {
      ev.preventDefault(); await send({ type: "track", item: it }); await refresh(); ev.target.textContent = "Tracked ✓";
    });
    row.querySelector(".comps").addEventListener("click", (ev) => { ev.preventDefault(); openComps(it.title); });
  });
}

$("#scanAllBtn").addEventListener("click", async () => {
  if (!activeTab) { alert("Open the rlspear auction in this tab first."); return; }
  const status = $("#scanStatus");
  status.textContent = "Scanning… this can take ~10s.";
  $("#scanAllBtn").disabled = true;
  const res = await tabSend(activeTab.id, { type: "scanAll" });
  $("#scanAllBtn").disabled = false;
  if (!res || !res.ok) {
    status.textContent = res && res.error === "open-auction-list-first"
      ? "Open the auction's lot list first (so it knows which auction), then scan."
      : "Scan failed — try again on the auction page.";
    return;
  }
  status.textContent = `Scanned ${res.items.length} lots across ${res.pages} page(s).`;
  await send({ type: "saveCatalog", items: res.items, pages: res.pages });
  renderValueResults(res.items);
});

async function loadCachedCatalog() {
  const cat = await send({ type: "getCatalog" });
  if (cat && cat.items && cat.items.length) {
    $("#scanStatus").textContent = `Cached: ${cat.items.length} lots (scan again to refresh).`;
    renderValueResults(cat.items);
  }
}

$("#refreshBtn").addEventListener("click", async () => { await refresh(); await loadPage(); });
$("#pageToggle").addEventListener("click", () => $("#pageBody").classList.toggle("hidden"));
$("#valueToggle").addEventListener("click", () => { $("#valueBody").classList.toggle("hidden"); loadCachedCatalog(); });
$("#settingsToggle").addEventListener("click", () => $("#settingsBody").classList.toggle("hidden"));
$("#premiumPct").addEventListener("change", () => {
  state.settings.premiumPct = parseFloat($("#premiumPct").value) || 0;
  send({ type: "saveSettings", settings: state.settings });
});
["outbidAlerts", "endingSoonAlerts"].forEach((k) =>
  $("#" + k).addEventListener("change", () => { state.settings[k] = $("#" + k).checked; send({ type: "saveSettings", settings: state.settings }); }));
$("#endingSoonLeadMin").addEventListener("change", () => {
  state.settings.endingSoonLeadMin = parseInt($("#endingSoonLeadMin").value, 10) || 10;
  send({ type: "saveSettings", settings: state.settings });
});

(async function init() { await refresh(); await loadPage(); startTicker(); })();
