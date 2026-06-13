/*
 * popup.js — the dashboard UI.
 * Talks to the background worker for state, and to the active rlspear tab for
 * live reads, calibration and test bids.
 */
"use strict";

const $ = (sel) => document.querySelector(sel);

let state = { watchlist: {}, settings: {} };
let activeTab = null;
let pageLot = null; // live read of the lot in the active tab (if any)

function fmtMoney(n) {
  return n == null ? "—" : "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function fmtTime(secs) {
  if (secs == null) return "—";
  if (secs <= 0) return "closed";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

async function send(msg) {
  return new Promise((res) => chrome.runtime.sendMessage(msg, (r) => res(r)));
}
async function tabSend(tabId, msg) {
  return new Promise((res) => {
    chrome.tabs.sendMessage(tabId, msg, (r) => {
      if (chrome.runtime.lastError) return res(null);
      res(r);
    });
  });
}

async function refreshState() {
  state = await send({ type: "getState" });
  applySettingsToUI();
  renderList();
}

function applySettingsToUI() {
  const s = state.settings || {};
  $("#dryRun").checked = !!s.dryRun;
  $("#increment").value = s.increment != null ? s.increment : (s.bidIncrement || 0);
  $("#dryBadge").classList.toggle("hidden", !s.dryRun);
  $("#lead").value = s.defaultLeadSeconds || 6;
  // mark calibrated fields
  const host = activeTab ? new URL(activeTab.url).host : null;
  const cal = (s.selectors && host && s.selectors[host]) || {};
  document.querySelectorAll(".cali").forEach((b) => {
    b.classList.toggle("done", !!cal[b.dataset.field]);
  });
}

async function loadActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab && /rlspear\.com/.test(tab.url || "") ? tab : null;
  if (!activeTab) {
    $("#currentBody").textContent = "Open an rlspear lot page to add it.";
    $("#currentActions").classList.add("hidden");
    $("#currentExtra").classList.add("hidden");
    return;
  }
  pageLot = await tabSend(activeTab.id, { type: "readLotNow" });
  renderCurrent();
}

function renderCurrent() {
  if (!pageLot) {
    $("#currentBody").textContent = "Couldn't read this page. Try Calibrate below.";
    return;
  }
  const already = state.watchlist[pageLot.key];
  $("#currentBody").innerHTML =
    `<div class="t" title="${escapeHtml(pageLot.title)}">${escapeHtml(pageLot.title || "(untitled lot)")}</div>` +
    `<div class="meta">` +
    `<span>Current ${fmtMoney(pageLot.currentPrice)}</span>` +
    `<span>${fmtTime(pageLot.secondsLeft)} left</span>` +
    statusPill(pageLot.status) +
    `</div>`;
  $("#currentActions").classList.remove("hidden");
  $("#currentExtra").classList.remove("hidden");
  if (already) {
    $("#maxBid").value = already.maxBid || "";
    $("#mode").value = already.mode || "snipe";
    $("#lead").value = already.snipeLeadSeconds || state.settings.defaultLeadSeconds || 6;
    $("#addBtn").textContent = "Update lot";
  } else {
    $("#addBtn").textContent = "Watch lot";
  }
}

function statusPill(status) {
  if (status === "winning") return `<span class="pill win">Winning</span>`;
  if (status === "outbid") return `<span class="pill lose">Outbid</span>`;
  return `<span class="pill mode">status ?</span>`;
}

function renderList() {
  const wl = state.watchlist || {};
  const keys = Object.keys(wl).sort((a, b) => {
    const ca = wl[a].closeEpoch || Infinity, cb = wl[b].closeEpoch || Infinity;
    return ca - cb;
  });
  const list = $("#list");
  if (!keys.length) {
    list.innerHTML = `<div class="muted small">No lots yet. Open a lot and click "Watch lot".</div>`;
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  list.innerHTML = keys.map((k) => {
    const e = wl[k];
    const secs = e.closeEpoch ? e.closeEpoch - now : null;
    const cap = e.lastCurrentPrice != null && e.maxBid && e.lastCurrentPrice >= e.maxBid;
    return `<div class="lot" data-key="${encodeURIComponent(k)}">
      <div class="t" title="${escapeHtml(e.title || "")}">${escapeHtml(e.title || "(lot)")}</div>
      <div class="meta">
        <span>${fmtMoney(e.lastCurrentPrice)} / max ${fmtMoney(e.maxBid)}</span>
        <span>${fmtTime(secs)}</span>
        ${statusPill(e.lastStatus)}
        <span class="pill mode">${e.mode}${e.enabled ? "" : " · off"}</span>
        ${cap ? `<span class="pill cap">at max</span>` : ""}
      </div>
      <div class="actions">
        <a class="link open" href="#">Open</a>
        <a class="link toggle" href="#">${e.enabled ? "Pause" : "Resume"}</a>
        <a class="link remove" href="#">Remove</a>
      </div>
    </div>`;
  }).join("");

  list.querySelectorAll(".lot").forEach((row) => {
    const key = decodeURIComponent(row.dataset.key);
    row.querySelector(".open").addEventListener("click", (ev) => {
      ev.preventDefault();
      chrome.tabs.create({ url: wl[key].url || key });
    });
    row.querySelector(".toggle").addEventListener("click", async (ev) => {
      ev.preventDefault();
      wl[key].enabled = !wl[key].enabled;
      await send({ type: "saveWatchlist", watchlist: wl });
      refreshState();
    });
    row.querySelector(".remove").addEventListener("click", async (ev) => {
      ev.preventDefault();
      delete wl[key];
      await send({ type: "saveWatchlist", watchlist: wl });
      refreshState();
    });
  });
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- actions --------------------------------------------------------------
$("#addBtn").addEventListener("click", async () => {
  if (!pageLot) return;
  const wl = state.watchlist;
  const max = parseFloat($("#maxBid").value);
  const entry = wl[pageLot.key] || {
    key: pageLot.key, addedAt: Date.now(), log: []
  };
  entry.url = pageLot.url;
  entry.title = pageLot.title;
  entry.maxBid = Number.isFinite(max) ? max : entry.maxBid || 0;
  entry.mode = $("#mode").value;
  entry.snipeLeadSeconds = parseInt($("#lead").value, 10) || 6;
  entry.enabled = true;
  entry.lastCurrentPrice = pageLot.currentPrice;
  entry.lastStatus = pageLot.status;
  if (pageLot.secondsLeft != null) entry.closeEpoch = Math.floor(Date.now() / 1000) + pageLot.secondsLeft;
  wl[pageLot.key] = entry;
  await send({ type: "saveWatchlist", watchlist: wl });
  await refreshState();
  renderCurrent();
});

$("#compsBtn").addEventListener("click", () => {
  const q = (pageLot && pageLot.title) || "";
  const url = "https://www.ebay.com/sch/i.html?_nkw=" + encodeURIComponent(q) +
    "&LH_Sold=1&LH_Complete=1&_sop=13";
  chrome.tabs.create({ url });
});

$("#refreshBtn").addEventListener("click", refreshState);

// settings
$("#dryRun").addEventListener("change", async () => {
  state.settings.dryRun = $("#dryRun").checked;
  await send({ type: "saveSettings", settings: state.settings });
  $("#dryBadge").classList.toggle("hidden", !state.settings.dryRun);
});
$("#increment").addEventListener("change", async () => {
  state.settings.bidIncrement = parseFloat($("#increment").value) || 0;
  await send({ type: "saveSettings", settings: state.settings });
});

$("#settingsToggle").addEventListener("click", () => {
  $("#settingsBody").classList.toggle("hidden");
});

// calibration
document.querySelectorAll(".cali").forEach((btn) => {
  btn.addEventListener("click", async () => {
    if (!activeTab) { alert("Open an rlspear lot page first."); return; }
    const field = btn.dataset.field;
    const labels = {
      title: "lot title", currentPrice: "current price", timeLeft: "time left",
      bidButton: "Bid button", bidInput: "bid amount box", status: "winning / outbid text"
    };
    const res = await tabSend(activeTab.id, { type: "pickElement", label: labels[field] });
    if (res && res.selector) {
      const host = new URL(activeTab.url).host;
      state.settings.selectors = state.settings.selectors || {};
      state.settings.selectors[host] = state.settings.selectors[host] || {};
      state.settings.selectors[host][field] = res.selector;
      await send({ type: "saveSettings", settings: state.settings });
      applySettingsToUI();
      // refresh the live read with the new selector
      pageLot = await tabSend(activeTab.id, { type: "readLotNow" });
      renderCurrent();
    }
  });
});

$("#clearCali").addEventListener("click", async () => {
  if (!activeTab) return;
  const host = new URL(activeTab.url).host;
  if (state.settings.selectors) delete state.settings.selectors[host];
  await send({ type: "saveSettings", settings: state.settings });
  applySettingsToUI();
});

$("#testBtn").addEventListener("click", async () => {
  if (!activeTab) { alert("Open an rlspear lot page first."); return; }
  // ensure this lot is in the watchlist with a max so the content script bids
  if (!pageLot || !state.watchlist[pageLot.key]) {
    alert('Click "Watch lot" first and set a max bid.');
    return;
  }
  await tabSend(activeTab.id, { type: "testBid" });
  setTimeout(refreshState, 600);
});

// init
(async function init() {
  await refreshState();
  await loadActiveTab();
  applySettingsToUI();
})();
