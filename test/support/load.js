"use strict";
/*
 * Loaders that run the extension's browser scripts in a minimal vm sandbox so
 * their browser-context functions can be unit-tested without a real browser.
 */
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "..", "extension", "src");
const read = (name) => fs.readFileSync(path.join(SRC, name), "utf8");

// selectors.js is a browser IIFE that publishes window.RLSpearSelectors and
// reads a few globals (location, URL) only inside helpers we exercise.
function loadSelectors() {
  const sandbox = {
    window: {},
    CSS: { escape: (s) => s },
    location: { href: "https://bid.rlspear.com/Public/Auction/Listing" },
    URL,
  };
  vm.createContext(sandbox);
  vm.runInContext(read("selectors.js"), sandbox);
  return sandbox.window.RLSpearSelectors;
}

// background.js is a service-worker script that touches chrome.* at load time
// (alarm + listener registration). Stub those and return the sandbox global,
// onto which its top-level function declarations (e.g. liveEndEpoch) attach.
function loadBackground() {
  const noop = () => {};
  const sandbox = {
    console,
    chrome: {
      storage: { local: { get: async () => ({}), set: async () => {} } },
      notifications: { create: noop },
      runtime: { getURL: (p) => p, onMessage: { addListener: noop }, onInstalled: { addListener: noop } },
      alarms: { create: noop, onAlarm: { addListener: noop } },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(read("background.js"), sandbox);
  return sandbox;
}

module.exports = { loadSelectors, loadBackground };
