/*
 * background.js  (service worker)
 * ----------------------------------------------------------------------------
 * The brain that persists across pages:
 *   - Stores the watchlist + settings in chrome.storage.local.
 *   - Receives live lot updates from content scripts and saves the latest
 *     price / status / close time per lot.
 *   - Schedules a wake-up alarm a couple of minutes before each snipe lot
 *     closes, then opens/focuses a tab on that lot so the content script can
 *     run the precise end-game timer. (The browser must be running.)
 *   - Fires desktop notifications.
 * ----------------------------------------------------------------------------
 */

const DEFAULT_SETTINGS = {
  defaultLeadSeconds: 6,
  defaultMode: "snipe",
  bidIncrement: 0, // 0 = trust the site's required next-bid value
  dryRun: true, // SAFETY: no real bids until the user turns this off
  selectors: {} // { host: { bidButton, bidInput, currentPrice, title, timeLeft, status, ... } }
};

const PREOPEN_LEAD_SECONDS = 150; // open the lot tab ~2.5 min before close

// ---- storage helpers ------------------------------------------------------
async function getState() {
  const data = await chrome.storage.local.get(["watchlist", "settings"]);
  return {
    watchlist: data.watchlist || {},
    settings: Object.assign({}, DEFAULT_SETTINGS, data.settings || {})
  };
}
async function setWatchlist(wl) {
  await chrome.storage.local.set({ watchlist: wl });
}
async function setSettings(s) {
  await chrome.storage.local.set({ settings: s });
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

// ---- lot update from content script --------------------------------------
async function handleLotUpdate(lot) {
  const { watchlist, settings } = await getState();
  const entry = watchlist[lot.key];
  if (entry) {
    entry.title = lot.title || entry.title;
    entry.lastCurrentPrice = lot.currentPrice != null ? lot.currentPrice : entry.lastCurrentPrice;
    entry.lastStatus = lot.status || entry.lastStatus;
    entry.lastSeenAt = lot.seenAt;
    entry.url = lot.url || entry.url;
    if (lot.secondsLeft != null) {
      entry.closeEpoch = nowSec() + lot.secondsLeft; // refresh from live clock
    }
    watchlist[lot.key] = entry;
    await setWatchlist(watchlist);
    await rescheduleAlarms();
  }
  return { entry: entry || null, settings };
}

// ---- alarm scheduling -----------------------------------------------------
async function rescheduleAlarms() {
  const { watchlist } = await getState();
  await chrome.alarms.clearAll();
  // A heartbeat so the worker periodically re-evaluates even without page pings.
  chrome.alarms.create("heartbeat", { periodInMinutes: 1 });

  for (const key of Object.keys(watchlist)) {
    const e = watchlist[key];
    if (!e.enabled || e.mode !== "snipe" || !e.closeEpoch) continue;
    const wakeAt = (e.closeEpoch - PREOPEN_LEAD_SECONDS) * 1000;
    const when = Math.max(wakeAt, Date.now() + 2000);
    chrome.alarms.create("snipe:" + key, { when });
  }
}

async function onAlarm(alarm) {
  if (alarm.name === "heartbeat") {
    await checkImminent();
    return;
  }
  if (alarm.name.startsWith("snipe:")) {
    const key = alarm.name.slice("snipe:".length);
    await openLotTab(key);
  }
}

// If any snipe lot is within the pre-open window, make sure its tab is open.
async function checkImminent() {
  const { watchlist } = await getState();
  for (const key of Object.keys(watchlist)) {
    const e = watchlist[key];
    if (!e.enabled || e.mode !== "snipe" || !e.closeEpoch) continue;
    const secsLeft = e.closeEpoch - nowSec();
    if (secsLeft > 0 && secsLeft <= PREOPEN_LEAD_SECONDS) {
      await openLotTab(key);
    }
  }
}

async function openLotTab(key) {
  const { watchlist } = await getState();
  const e = watchlist[key];
  if (!e) return;
  const url = e.url || key;

  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((t) => t.url && sameLot(t.url, url));
  if (existing) {
    await chrome.tabs.reload(existing.id);
    notify("Snipe ready", `Refreshed "${e.title || "lot"}" for the final countdown.`);
    return;
  }
  await chrome.tabs.create({ url, active: false });
  notify("Snipe ready", `Opened "${e.title || "lot"}" to bid in the final seconds.`);
}

function sameLot(a, b) {
  try {
    const ua = new URL(a), ub = new URL(b);
    const ida = ua.searchParams.get("AuctionId");
    const idb = ub.searchParams.get("AuctionId");
    const la = ua.searchParams.get("LotId") || ua.searchParams.get("ItemId");
    const lb = ub.searchParams.get("LotId") || ub.searchParams.get("ItemId");
    if (ida && idb) return ida === idb && (la || "") === (lb || "");
    return ua.pathname === ub.pathname && ua.search === ub.search;
  } catch (_) {
    return a === b;
  }
}

// ---- notifications & logs -------------------------------------------------
function notify(title, message) {
  try {
    chrome.notifications.create("", {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: title || "RL Spear Bid Assistant",
      message: message || ""
    });
  } catch (_) {}
}

async function appendLog(key, msg, at) {
  const { watchlist } = await getState();
  const e = watchlist[key];
  if (!e) return;
  e.log = (e.log || []).slice(-40);
  e.log.push({ at: at || Date.now(), msg });
  watchlist[key] = e;
  await setWatchlist(watchlist);
}

// ---- message router -------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "lotUpdate":
        sendResponse(await handleLotUpdate(msg.lot));
        break;
      case "lotLog":
        await appendLog(msg.key, msg.msg, msg.at);
        sendResponse({ ok: true });
        break;
      case "snipeResult":
        await appendLog(msg.key, "Result: " + JSON.stringify({
          ok: msg.ok, dryRun: msg.dryRun, capped: msg.capped, nextBid: msg.nextBid, error: msg.error
        }), Date.now());
        if (msg.ok && !msg.dryRun) {
          const { watchlist } = await getState();
          if (watchlist[msg.key]) {
            watchlist[msg.key].snipeState = "fired";
            await setWatchlist(watchlist);
          }
        }
        sendResponse({ ok: true });
        break;
      case "notify":
        notify(msg.title, msg.message);
        sendResponse({ ok: true });
        break;
      case "getState":
        sendResponse(await getState());
        break;
      case "saveSettings":
        await setSettings(msg.settings);
        await broadcastSettings(msg.settings);
        sendResponse({ ok: true });
        break;
      case "saveWatchlist":
        await setWatchlist(msg.watchlist);
        await rescheduleAlarms();
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false, error: "unknown" });
    }
  })();
  return true; // keep the channel open for async sendResponse
});

async function broadcastSettings(settings) {
  const tabs = await chrome.tabs.query({ url: ["*://*.rlspear.com/*"] });
  for (const t of tabs) {
    chrome.tabs.sendMessage(t.id, { type: "settings", settings }).catch(() => {});
  }
}

chrome.alarms.onAlarm.addListener(onAlarm);
chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await getState();
  await setSettings(settings); // materialize defaults
  await rescheduleAlarms();
});
chrome.runtime.onStartup.addListener(rescheduleAlarms);
