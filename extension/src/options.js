"use strict";
const fmt = (ts) => new Date(ts).toLocaleString();
const esc = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

chrome.runtime.sendMessage({ type: "getState" }, (state) => {
  const t = (state && state.tracked) || {};
  const keys = Object.keys(t);
  const root = document.getElementById("log");
  if (!keys.length) { root.innerHTML = `<p class="muted">No tracked lots yet.</p>`; return; }
  root.innerHTML = keys.map((k) => {
    const e = t[k];
    const logs = (e.log || []).slice().reverse().map((l) => `${fmt(l.at)}  —  ${esc(l.msg)}`).join("\n") || "(no activity yet)";
    return `<div class="entry">
      <div class="t"><strong>${esc(e.title || "(lot " + k + ")")}</strong></div>
      <div class="muted small">current $${e.currentBid ?? "?"} · your max $${e.myMaxBid ?? "—"} · target $${e.targetMax ?? "—"} · ${e.lastStatus || "?"}</div>
      <div class="logbox">${logs}</div>
    </div>`;
  }).join("");
});
