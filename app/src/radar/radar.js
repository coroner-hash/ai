import "../landing/fonts.js";
import "../landing/landing.css";
import "../check/check.css";
import "../landing/theme.css";
import "./radar.css";
import "../landing/menu.js";

// Clone Radar: waves of reused tickers, computed in the browser from the open collector's ticker index.
// Each index entry: [token, firstSeenISO, dex, firstLiqUsd, firstVol24Usd], oldest first, keyed by normalised ticker.
const SRC = "https://raw.githubusercontent.com/coroner-hash/ai/main/data/symbols.json";
const DEX = { "pons-v2": "Pons", "pons-v2-dex": "Pons (graduated)", "uniswap-v4-robinhood": "Uniswap v4", "uniswap-v3-robinhood": "Uniswap v3", "uniswap-v2-robinhood": "Uniswap v2", "bankr-robinhood": "Bankr", "clanker-robinhood": "Clanker", "virtuals-robinhood": "Virtuals", "uniswap-pools-trade": "Uniswap" };
const HOUR = 3_600_000;
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usd = (n) => (typeof n !== "number" || !isFinite(n) ? "n/a" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`);
const fmtTime = (ms) => new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
const ago = (ms, now) => {
  const h = (now - ms) / HOUR;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} d ago`;
};

let index = null;
let anchor = 0; // latest first-seen in the data: windows are measured back from here, so a late collector run never empties the page
let windowH = 24;

function say(text) {
  $("rd-msg").hidden = !text;
  $("rd-msg").textContent = text || "";
}

function waves(hours, query) {
  const from = anchor - hours * HOUR;
  const out = [];
  for (const [key, entries] of Object.entries(index)) {
    if (query && !key.includes(query)) continue;
    const recent = entries.filter((e) => Date.parse(e[1]) >= from);
    if (!query && recent.length < 2) continue;
    if (query && !recent.length && !entries.length) continue;
    out.push({ key, entries, recent });
  }
  out.sort((a, b) => b.recent.length - a.recent.length || b.entries.length - a.entries.length);
  return out.slice(0, query ? 40 : 25);
}

function spark(recent, hours) {
  const buckets = hours <= 24 ? hours : Math.ceil(hours / 3);
  const size = (hours / buckets) * HOUR;
  const from = anchor - hours * HOUR;
  const counts = new Array(buckets).fill(0);
  for (const e of recent) {
    const i = Math.min(buckets - 1, Math.floor((Date.parse(e[1]) - from) / size));
    if (i >= 0) counts[i]++;
  }
  const max = Math.max(1, ...counts);
  const box = el("div", "rd-spark");
  box.setAttribute("role", "img");
  box.setAttribute("aria-label", `Launches over the last ${hours} hours`);
  for (const c of counts) {
    const bar = el("i");
    bar.style.height = `${Math.max(c ? 8 : 2, Math.round((c / max) * 100))}%`;
    if (c) bar.className = "on";
    box.append(bar);
  }
  return box;
}

function render() {
  const query = $("rd-q").value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const list = $("rd-list");
  list.replaceChildren();
  const rows = waves(windowH, query);
  if (!rows.length) {
    say(query ? "No token with that ticker in our data." : "No ticker was launched twice in this window.");
    return;
  }
  say("");
  rows.forEach((w, i) => {
    const li = el("li", "rd-item");
    const head = el("div", "rd-head");
    const name = el("div", "rd-name");
    name.append(el("span", "rd-rank", String(i + 1).padStart(2, "0")), el("b", "", `$${w.key.toUpperCase()}`));
    const count = el("div", "rd-count");
    count.append(el("b", "", String(w.recent.length)), el("span", "", `new in ${windowH === 72 ? "3 days" : windowH + " h"} · ${w.entries.length} total`));
    head.append(name, spark(w.recent, windowH), count);
    li.append(head);

    const first = w.entries[0];
    const busiest = w.entries.reduce((a, b) => ((b[4] ?? 0) > (a[4] ?? 0) ? b : a));
    const meta = el("div", "rd-meta");
    const firstEl = el("p");
    firstEl.append(el("span", "rd-k", "First seen "), link(first[0]), el("span", "rd-d", ` · ${fmtTime(Date.parse(first[1]))}`));
    const busyEl = el("p");
    busyEl.append(el("span", "rd-k", "Busiest at first sighting "), link(busiest[0]), el("span", "rd-d", ` · ${usd(busiest[4])} 24h volume`));
    meta.append(firstEl, busyEl);
    li.append(meta);

    const det = el("details", "rd-all");
    const sum = el("summary", "", `All ${w.recent.length || w.entries.length} contracts${w.recent.length ? " in this window" : ""}`);
    det.append(sum);
    det.addEventListener("toggle", () => {
      if (!det.open || det.dataset.filled) return;
      det.dataset.filled = "1";
      const tbl = el("div", "rd-table");
      const rowsToShow = (w.recent.length ? w.recent : w.entries).slice().sort((a, b) => b[1].localeCompare(a[1])).slice(0, 200);
      for (const e of rowsToShow) {
        const r = el("div", "rd-row");
        r.append(el("span", "rd-t", ago(Date.parse(e[1]), anchor)), link(e[0]), el("span", "rd-x", DEX[e[2]] ?? (e[2] || "")), el("span", "rd-x", `liq ${usd(e[3])}`));
        tbl.append(r);
      }
      det.append(tbl);
    });
    li.append(det);
    list.append(li);
  });
}

function link(addr) {
  const a = el("a", "rd-addr", short(addr));
  a.href = `/check?address=${addr}`;
  a.title = `Check ${addr}`;
  return a;
}

function stats() {
  const from = anchor - 24 * HOUR;
  let fresh = 0, reused = 0, wave = ["", 0];
  for (const [key, entries] of Object.entries(index)) {
    let n = 0;
    entries.forEach((e, i) => {
      if (Date.parse(e[1]) < from) return;
      fresh++;
      n++;
      if (i > 0) reused++;
    });
    if (n > wave[1]) wave = [key, n];
  }
  $("s-new").textContent = fresh.toLocaleString("en-US");
  $("s-reuse").textContent = fresh ? `${Math.round((100 * reused) / fresh)}%` : "n/a";
  $("s-wave").textContent = wave[1] ? `$${wave[0].toUpperCase()} ×${wave[1]}` : "none";
}

document.querySelectorAll(".rd-tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    windowH = Number(b.dataset.w);
    document.querySelectorAll(".rd-tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    render();
  }),
);
let t = null;
$("rd-q").addEventListener("input", () => {
  clearTimeout(t);
  t = setTimeout(render, 150);
});

(async () => {
  say("Reading the open collector…");
  try {
    const r = await fetch(SRC, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(String(r.status));
    index = await r.json();
    for (const entries of Object.values(index)) for (const e of entries) anchor = Math.max(anchor, Date.parse(e[1]));
    const q = new URLSearchParams(location.search).get("t");
    if (q) $("rd-q").value = q;
    stats();
    render();
    const asOf = el("p", "rd-asof", `Data as of the latest pool seen: ${fmtTime(anchor)}.`);
    $("rd-stats").after(asOf);
  } catch {
    say("Could not read the collector data right now. Try again in a minute.");
  }
  document.documentElement.dataset.ready = "1";
})();
