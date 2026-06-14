"use strict";
/*
 * Tiny zero-dependency DOM shim — just enough surface for selectors.js's
 * read-only card helpers (querySelector/All, getAttribute, classList, value,
 * textContent, parentElement, contains, getElementById). It is NOT a general
 * DOM: it supports only the selector grammar selectors.js actually uses
 * (tag, .class, [attr], [attr^=], [attr*=], and comma groups — no combinators).
 *
 * Fixtures are built programmatically via el()/root() to mirror the confirmed
 * Maxanet markup documented in CLAUDE.md.
 */

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.attributes = {};
    this.children = [];
    this.parentElement = null;
    this.id = "";
    this._text = null;
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === "id") this.id = String(v);
  }
  getAttribute(k) {
    return k in this.attributes ? this.attributes[k] : null;
  }
  get className() { return this.attributes.class || ""; }
  get classList() { return this.className.split(/\s+/).filter(Boolean); }
  get value() { return this.attributes.value !== undefined ? this.attributes.value : ""; }
  set value(v) { this.attributes.value = String(v); }
  appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
  set textContent(t) { this._text = t; this.children = []; }
  get textContent() {
    if (this._text !== null) return this._text;
    return this.children.map((c) => c.textContent).join("");
  }
  get innerText() { return this.textContent; }
  getBoundingClientRect() { return { width: 1, height: 1 }; }
  contains(node) {
    if (node === this) return true;
    return this.children.some((c) => c.contains(node));
  }
  _descendants() {
    const out = [];
    for (const c of this.children) { out.push(c); out.push(...c._descendants()); }
    return out;
  }
  matches(sel) { return matchOne(this, sel.trim()); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const groups = sel.split(",").map((s) => s.trim()).filter(Boolean);
    return this._descendants().filter((node) => groups.some((g) => matchOne(node, g)));
  }
  getElementById(id) {
    return this._descendants().find((node) => node.id === id) || null;
  }
}

// Match a single compound selector (no combinators) against one element.
function matchOne(node, sel) {
  let rest = sel;
  const tagM = rest.match(/^[a-zA-Z][a-zA-Z0-9]*/);
  if (tagM) {
    if (node.tagName !== tagM[0].toUpperCase()) return false;
    rest = rest.slice(tagM[0].length);
  }
  const tokenRe = /\.([\w-]+)|\[([\w-]+)(?:([\^\*\$]?=)"([^"]*)")?\]/g;
  let t;
  while ((t = tokenRe.exec(rest))) {
    if (t[1]) {
      if (!node.classList.includes(t[1])) return false;
    } else {
      const av = node.getAttribute(t[2]);
      if (av === null) return false;
      const op = t[3], val = t[4];
      if (op === "=" && av !== val) return false;
      if (op === "^=" && !av.startsWith(val)) return false;
      if (op === "*=" && !av.includes(val)) return false;
      if (op === "$=" && !av.endsWith(val)) return false;
    }
  }
  return true;
}

function el(tag, props = {}, children = []) {
  const node = new El(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.appendChild(c);
  return node;
}

const root = (children) => el("div", { class: "auction-items" }, children);

module.exports = { El, el, root };
