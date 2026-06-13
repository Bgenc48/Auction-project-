"use strict";

function fmt(ts) {
  return new Date(ts).toLocaleString();
}
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

chrome.runtime.sendMessage({ type: "getState" }, (state) => {
  const wl = (state && state.watchlist) || {};
  const keys = Object.keys(wl);
  const root = document.getElementById("log");
  if (!keys.length) {
    root.innerHTML = `<p class="muted">No lots watched yet.</p>`;
    return;
  }
  root.innerHTML = keys.map((k) => {
    const e = wl[k];
    const logs = (e.log || []).slice().reverse()
      .map((l) => `${fmt(l.at)}  —  ${escapeHtml(l.msg)}`).join("\n") || "(no activity yet)";
    return `<div class="entry">
      <div class="t"><strong>${escapeHtml(e.title || "(lot)")}</strong></div>
      <div class="muted small">max $${e.maxBid || 0} · mode ${e.mode} · ${e.enabled ? "active" : "paused"}</div>
      <div class="logbox">${logs}</div>
    </div>`;
  }).join("");
});
