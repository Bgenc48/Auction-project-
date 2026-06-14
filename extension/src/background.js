/*
 * background.js (service worker) — Maxanet Max-Bid strategy edition.
 *
 * Stores the lots you're tracking, receives live page snapshots from content
 * scripts, and fires desktop alerts when:
 *   • a tracked lot flips to "outbid", or
 *   • a tracked lot is about to close (within your lead time).
 *
 * No automated bidding. The dashboard + alerts let YOU raise your Max Bid in
 * time, which is the only thing that actually wins on a dynamic-close auction.
 */

const DEFAULT_SETTINGS = {
  outbidAlerts: true,
  endingSoonAlerts: true,
  endingSoonLeadMin: 10, // notify when a tracked lot is within N minutes of close
  premiumPct: 13, // rlspear buyer's premium, used in the value engine
  selectors: {}
};

async function getState() {
  const d = await chrome.storage.local.get(["tracked", "settings"]);
  return {
    tracked: d.tracked || {},
    settings: Object.assign({}, DEFAULT_SETTINGS, d.settings || {})
  };
}
const setTracked = (t) => chrome.storage.local.set({ tracked: t });
const setSettings = (s) => chrome.storage.local.set({ settings: s });

function notify(title, message, id) {
  try {
    chrome.notifications.create(id || "", {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: title || "RL Spear Bid Assistant",
      message: message || "",
      priority: 2
    });
  } catch (_) {}
}

function liveEndEpoch(item) {
  // Convert the snapshot's end time into an absolute epoch using the server's
  // "now" so we don't trust the local clock.
  if (item.endMs == null) return null;
  if (item.serverNowMs == null) return item.endMs;
  const skew = Date.now() - item.serverNowMs; // local - server at capture
  return item.endMs + skew;
}

async function onPageItems(payload) {
  const { tracked, settings } = await getState();
  let changed = false;

  for (const item of payload.items || []) {
    const t = tracked[item.id];
    if (!t) continue; // only react to lots the user is tracking

    const prevStatus = t.lastStatus;
    t.title = item.title || t.title;
    t.value = item.value && item.value.retail ? item.value : t.value;
    t.currentBid = item.currentBid != null ? item.currentBid : t.currentBid;
    t.myMaxBid = item.myMaxBid != null ? item.myMaxBid : t.myMaxBid;
    t.lastStatus = item.status || t.lastStatus;
    const newEnd = liveEndEpoch(item);
    if (newEnd != null) {
      // Dynamic Closing pushes the close out by ~4 min on any late bid. If the
      // end time jumped back outside the "ending soon" window, re-arm the alert
      // so the user is warned again as the *extended* close approaches.
      const leadMs = (settings.endingSoonLeadMin || 0) * 60000;
      if (t.endNotified && newEnd - Date.now() > leadMs) t.endNotified = false;
      t.endEpoch = newEnd;
    }
    t.url = item.url || t.url;
    t.index = item.index || t.index;
    t.lastSeenAt = Date.now();

    // Outbid alert (only on the transition into "outbid").
    if (settings.outbidAlerts && prevStatus !== "outbid" && item.status === "outbid") {
      notify("⚠️ Outbid: " + (t.title || "a lot"),
        `Now $${item.currentBid ?? "?"}. Your max: $${t.myMaxBid ?? "not set"}. Raise it if it's still worth it.`,
        "outbid-" + item.id);
      log(t, `Outbid — current $${item.currentBid}, your max $${t.myMaxBid ?? "—"}`);
    }
    if (item.status === "winning" && prevStatus === "outbid") {
      log(t, `Back in front at $${item.currentBid}`);
    }
    changed = true;
  }

  if (changed) await setTracked(tracked);
  return { ok: true };
}

function log(t, msg) {
  t.log = (t.log || []).slice(-40);
  t.log.push({ at: Date.now(), msg });
}

// Periodic check for "ending soon" on tracked lots.
async function checkEndingSoon() {
  const { tracked, settings } = await getState();
  if (!settings.endingSoonAlerts) return;
  const now = Date.now();
  let changed = false;
  for (const id of Object.keys(tracked)) {
    const t = tracked[id];
    if (!t.endEpoch || t.endNotified) continue;
    const minLeft = (t.endEpoch - now) / 60000;
    if (minLeft > 0 && minLeft <= settings.endingSoonLeadMin) {
      notify("⏰ Closing soon: " + (t.title || "a lot"),
        `~${Math.max(1, Math.round(minLeft))} min left. Status: ${t.lastStatus}. Current $${t.currentBid ?? "?"}.`,
        "soon-" + id);
      t.endNotified = true;
      changed = true;
    }
  }
  if (changed) await setTracked(tracked);
}

async function handleMessage(msg) {
  switch (msg.type) {
    case "pageItems":
      return await onPageItems(msg);
    case "getState":
      return await getState();
    case "track": {
      const { tracked } = await getState();
      const it = msg.item;
      tracked[it.id] = Object.assign(
        { id: it.id, addedAt: Date.now(), log: [] },
        tracked[it.id] || {},
        {
          title: it.title, url: it.url, index: it.index, value: it.value,
          currentBid: it.currentBid, myMaxBid: it.myMaxBid,
          targetMax: msg.targetMax != null ? msg.targetMax : (tracked[it.id] && tracked[it.id].targetMax) || null,
          lastStatus: it.status,
          endEpoch: liveEndEpoch(it),
          endNotified: false
        }
      );
      await setTracked(tracked);
      return { ok: true };
    }
    case "untrack": {
      const { tracked } = await getState();
      delete tracked[msg.id];
      await setTracked(tracked);
      return { ok: true };
    }
    case "setTarget": {
      const { tracked } = await getState();
      if (tracked[msg.id]) { tracked[msg.id].targetMax = msg.targetMax; await setTracked(tracked); }
      return { ok: true };
    }
    case "saveSettings":
      await setSettings(msg.settings);
      return { ok: true };
    case "saveCatalog":
      await chrome.storage.local.set({ catalog: { items: msg.items, at: Date.now(), pages: msg.pages } });
      return { ok: true };
    case "getCatalog":
      return (await chrome.storage.local.get(["catalog"])).catalog || null;
    default:
      return { ok: false };
  }
}

// Serialize all handling so frequent pageItems updates can't clobber a
// concurrent track / setTarget (read-modify-write race on stored state).
let opChain = Promise.resolve();
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  opChain = opChain
    .then(() => handleMessage(msg))
    .then((res) => sendResponse(res), (err) => sendResponse({ ok: false, error: String(err) }));
  return true; // keep the channel open for the async sendResponse
});

chrome.alarms.create("endingSoon", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "endingSoon") checkEndingSoon(); });
chrome.runtime.onInstalled.addListener(async () => { const { settings } = await getState(); await setSettings(settings); });
