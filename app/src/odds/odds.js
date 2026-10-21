import "../landing/fonts.js";
import "../landing/landing.css";
import "../check/check.css";
import "../landing/theme.css";
import "./odds.css";
import "../landing/menu.js";

// Actuarial table: 24-hour survival of Robinhood Chain tokens by what they looked like in their first hour.
// The table (data/odds.json) is rebuilt hourly by the open collector. A token is priced from, in order:
// our own first sighting (shards for re-checked tokens, the ticker index for younger ones),
// or live GeckoTerminal numbers while it is still in its first 90 minutes.
const RAW = "https://raw.githubusercontent.com/coroner-hash/ai/main/data/";
const GT = "https://api.geckoterminal.com/api/v2/networks/robinhood";
const DEXG = { "pons-v2": "pons", "uniswap-v4-robinhood": "v4", "uniswap-v3-robinhood": "v3", "uniswap-v2-robinhood": "v2" };
const DEX_LABEL = { pons: "Pons", v4: "Uniswap v4", v3: "Uniswap v3", v2: "Uniswap v2", other: "Other" };
const LIQ_LABEL = ["under $100 or not reported", "$100 to 5K", "$5K to 20K", "$20K to 100K", "$100K+"];
const SWAP_LABEL = ["under 5", "5 to 19", "20 to 99", "100 to 499", "500+"];
const VOL_LABEL = ["under $100", "$100 to 1K", "$1K to 10K", "$10K to 100K", "$100K+"];
const HOUR_LABEL = ["00 to 04", "04 to 08", "08 to 12", "12 to 16", "16 to 20", "20 to 24"];
const FATE = [
  ["alive", "still trading"],
  ["never", "never took off"],
  ["bled", "bled out"],
  ["lp", "liquidity removed"],
];
const MIN_N = 40;
const LIVE_MAX_MIN = 90;

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const pct = (a, n) => (n ? Math.round((100 * a) / n) : 0);
const band = (v, edges) => edges.reduce((b, e) => b + (v >= e ? 1 : 0), 0);
const usd = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`);
const liqText = (n) => (n >= 1 ? `${usd(n)} liquidity` : "liquidity not reported");
const isAddr = (s) => /^0x[0-9a-fA-F]{40}$/.test(s);
async function getJSON(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

let T = null; // odds.json
const pick = { dex: "pons", liq: 1, swaps: 1 };

// --- cohort lookup: the narrowest cohort with enough tokens -------------------------------------------------------
function cohort(dex, liq, swaps) {
  const tries = [
    [`${dex}|${liq}|${swaps}`, `born on ${DEX_LABEL[dex]} with ${LIQ_LABEL[liq]} liquidity and ${SWAP_LABEL[swaps]} swaps in the first hour`],
    [`*|${liq}|${swaps}`, `with ${LIQ_LABEL[liq]} liquidity and ${SWAP_LABEL[swaps]} swaps in the first hour (any DEX)`],
    [`${dex}|*|${swaps}`, `born on ${DEX_LABEL[dex]} with ${SWAP_LABEL[swaps]} swaps in the first hour`],
    [`*|*|${swaps}`, `with ${SWAP_LABEL[swaps]} swaps in the first hour`],
  ];
  for (const [k, words] of tries) {
    const c = T.cohorts[k];
    if (c && c[0] >= MIN_N) return { c, words, exact: k === tries[0][0] };
  }
  return { c: T.total, words: "of every kind", exact: false };
}

function draw(dex, liq, swaps) {
  const { c, words } = cohort(dex, liq, swaps);
  const [n, alive, never, bled, lp] = c;
  // largest-remainder rounding so the 100 squares always add up
  const raw = [alive, never, bled, lp].map((v) => (100 * v) / n);
  const fl = raw.map(Math.floor);
  let left = 100 - fl.reduce((a, b) => a + b, 0);
  raw.map((v, i) => [v - fl[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { fl[i]++; left--; } });
  $("od-n").textContent = String(fl[0]);
  const grid = $("od-grid");
  grid.replaceChildren();
  fl.forEach((k, i) => { for (let j = 0; j < k; j++) grid.append(el("i", FATE[i][0])); });
  grid.setAttribute("aria-label", FATE.map(([, w], i) => `${fl[i]} ${w}`).join(", "));
  $("od-legend").replaceChildren(...FATE.map(([cls, w], i) => {
    const li = el("li");
    li.append(el("i", cls), el("b", "", String(fl[i])), el("span", "", w));
    return li;
  }));
  $("od-basis").textContent = `Based on ${n.toLocaleString("en-US")} real tokens ${words}.`;
  syncSeg();
}

// --- what-if controls -----------------------------------------------------------------------------------------------
const SEG = {
  dex: Object.entries(DEX_LABEL),
  liq: LIQ_LABEL.map((l, i) => [i, l]),
  swaps: SWAP_LABEL.map((l, i) => [i, l]),
};
function buildSeg() {
  document.querySelectorAll(".od-seg").forEach((box) => {
    const f = box.dataset.f;
    for (const [v, label] of SEG[f]) {
      const b = el("button", "", label);
      b.type = "button";
      b.dataset.v = String(v);
      b.addEventListener("click", () => {
        pick[f] = f === "dex" ? v : Number(v);
        $("od-who").textContent = "A token you built.";
        $("od-fate").hidden = true;
        draw(pick.dex, pick.liq, pick.swaps);
      });
      box.append(b);
    }
  });
}
function syncSeg() {
  document.querySelectorAll(".od-seg").forEach((box) => {
    const f = box.dataset.f;
    box.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === String(pick[f]))));
  });
}

// --- the duel: name vs first hour -----------------------------------------------------------------------------------
function duel() {
  const t = T.factors.ticker, s = T.factors.swaps;
  const o = pct(t.original[1], t.original[0]), c = pct(t.copy[1], t.copy[0]);
  const lo = pct(s["0"][1], s["0"][0]), hi = pct(s["4"][1], s["4"][0]);
  $("d-orig").textContent = `${o}%`;
  $("d-copy").textContent = `${c}%`;
  $("d-low").textContent = `${lo}%`;
  $("d-high").textContent = `${hi}%`;
  const gap = Math.abs(o - c);
  $("d-name-v").textContent = gap <= 3 ? `${gap} point${gap === 1 ? "" : "s"} apart. A copied name is not a death sentence.` : `${gap} points apart.`;
  $("d-hour-v").textContent = `${(hi / Math.max(1, lo)).toFixed(1)}× the odds. The first hour is the tell.`;
  const [n] = T.total;
  $("od-cap").textContent = `Share of tokens still trading 24 hours after birth. ${n.toLocaleString("en-US")} Robinhood Chain tokens born ${fmtDay(T.born[0])} to ${fmtDay(T.born[1])}.`;
}
const fmtDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// --- full table -----------------------------------------------------------------------------------------------------
function table() {
  const [n, a] = T.total;
  $("od-table-sub").textContent = `${pct(a, n)}% of all ${n.toLocaleString("en-US")} tokens were still trading after 24 hours. Each row: how that share changes with one fact about the first hour.`;
  const groups = [
    ["Swaps in the first hour", "swaps", SWAP_LABEL],
    ["Liquidity in the first hour", "liq", LIQ_LABEL],
    ["Volume in the first hour", "vol", VOL_LABEL],
    ["Born on", "dex", null],
    ["Hour of birth (UTC)", "hour", HOUR_LABEL],
    ["Ticker", "ticker", null],
  ];
  const base = pct(a, n);
  const wrap = $("od-factors");
  wrap.replaceChildren();
  for (const [title, key, labels] of groups) {
    const box = el("div", "od-f");
    box.append(el("h3", "", title));
    const entries = Object.entries(T.factors[key] || {});
    if (key === "dex") entries.sort((x, y) => y[1][0] - x[1][0]);
    for (const [k, [cn, ca]] of entries) {
      if (cn < 30) continue;
      const p = pct(ca, cn);
      const row = el("div", "od-r");
      const label = labels ? labels[Number(k)] : key === "dex" ? DEX_LABEL[k] : k === "copy" ? "copied" : k;
      const bar = el("div", "od-bar");
      const fill = el("i");
      fill.style.width = `${p}%`;
      if (p >= base + 10) fill.className = "up";
      else if (p <= base - 10) fill.className = "down";
      const tick = el("u");
      tick.style.left = `${base}%`;
      bar.append(fill, tick);
      row.append(el("span", "od-l", label), bar, el("b", "", `${p}%`), el("small", "", cn.toLocaleString("en-US")));
      box.append(row);
    }
    wrap.append(box);
  }
}

// --- pricing a real token -------------------------------------------------------------------------------------------
function say(text) {
  $("od-msg").hidden = !text;
  $("od-msg").textContent = text || "";
}

async function price(addr) {
  addr = addr.trim().toLowerCase();
  if (!isAddr(addr)) return say("That doesn't look like a token address (0x followed by 40 characters).");
  say("Reading the token…");
  $("od-go").disabled = true;
  try {
    const [shard, pools] = await Promise.all([
      getJSON(`${RAW}shards/${addr.slice(2, 4)}.json`).catch(() => ({})),
      getJSON(`${GT}/tokens/${addr}/pools?page=1`).catch(() => null),
    ]);
    const mine = (shard[addr] || []).slice().sort((x, y) => x.created.localeCompare(y.created))[0];
    const live = (pools?.data || []).slice().sort((x, y) => x.attributes.pool_created_at.localeCompare(y.attributes.pool_created_at))[0];
    const sym = mine?.symbol || live?.attributes?.name?.split(" / ")[0] || "This token";
    let seen = null; // first sighting from the ticker index: [token, created, dex, liq, vol, swaps]
    if (!mine && live) {
      const key = sym.toLowerCase().replace(/[^a-z0-9]/g, "");
      const idx = await getJSON(`${RAW}symbols.json`).catch(() => ({}));
      seen = (idx[key] || []).find((e) => e[0] === addr && e.length > 5) || null;
    }
    if (seen) {
      const hours = Math.round((Date.now() - Date.parse(seen[1])) / 3600000);
      setPick(DEXG[seen[2]] || "other", seen[3] || 0, seen[5] || 0);
      $("od-who").textContent = `$${sym}, as our collector first saw it (born ${hours < 1 ? "under an hour" : hours + " h"} ago): ${liqText(seen[3] || 0)}, ${seen[5]} swaps.`;
      $("od-fate").hidden = true;
      draw(pick.dex, pick.liq, pick.swaps);
      say(hours < 24 ? "Its 24-hour re-check is still to come. Check back tomorrow to see how the table did." : "");
    } else if (mine?.first) {
      const f = mine.first;
      const mins = Math.max(1, Math.round((Date.parse(f.at) - Date.parse(mine.created)) / 60000));
      setPick(DEXG[mine.dex] || "other", f.liq_usd || 0, (f.buys_h24 || 0) + (f.sells_h24 || 0));
      $("od-who").textContent = `$${sym}, as our collector saw it ${mins} min after birth: ${liqText(f.liq_usd || 0)}, ${(f.buys_h24 || 0) + (f.sells_h24 || 0)} swaps.`;
      draw(pick.dex, pick.liq, pick.swaps);
      fate(mine);
      say("");
    } else if (live) {
      const at = live.attributes;
      const ageMin = Math.round((Date.now() - Date.parse(at.pool_created_at)) / 60000);
      if (ageMin > LIVE_MAX_MIN) {
        say(`$${sym} is ${ageMin >= 120 ? Math.round(ageMin / 60) + " hours" : ageMin + " min"} old and our collector did not see its first hour, so we can't price it honestly. Build it with the buttons below, or try a token from the nursery.`);
        return;
      }
      const tx = at.transactions?.h24 || {};
      const swaps = (tx.buys || 0) + (tx.sells || 0);
      const liq = Number(at.reserve_in_usd) || 0;
      setPick(DEXG[live.relationships?.dex?.data?.id] || "other", liq, swaps);
      $("od-who").textContent = `$${sym}, live at ${ageMin} min old: ${liqText(liq)}, ${swaps} swaps so far.`;
      $("od-fate").hidden = true;
      draw(pick.dex, pick.liq, pick.swaps);
      say("");
    } else {
      say("We couldn't find a pool for this token on Robinhood Chain.");
    }
    history.replaceState(null, "", `?address=${addr}`);
    $("od-who").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch {
    say("Could not read the token right now. Try again in a minute.");
  } finally {
    $("od-go").disabled = false;
  }
}

function setPick(dexId, liq, swaps) {
  pick.dex = dexId;
  pick.liq = band(liq, T.bands.liq);
  pick.swaps = band(swaps, T.bands.swaps);
}

// a token we already re-checked: what the table said at birth vs what happened
function fate(rec) {
  const o = rec.outcome;
  const box = $("od-fate");
  if (!o) { box.hidden = true; return; }
  const vol = o.vol_h24 || 0, sw = (o.buys_h24 || 0) + (o.sells_h24 || 0);
  const alive = vol >= 50 || sw > 2;
  box.hidden = false;
  box.replaceChildren(
    el("span", "od-k", `What happened, ${Math.round(o.age_h || 24)} h later`),
    el("b", alive ? "ok" : "dead", alive ? "Still trading" : "Stopped trading"),
    el("span", "", ` · ${usd(vol)} volume and ${sw} swaps in the last 24 h at the re-check.`),
  );
}

// --- the nursery: tokens born in the last hour ----------------------------------------------------------------------
async function nursery() {
  const list = $("od-nursery");
  const msg = $("od-ward-msg");
  msg.hidden = false;
  msg.textContent = "Reading the newest pools…";
  $("od-refresh").disabled = true;
  try {
    const pages = await Promise.all([1, 2].map((p) => getJSON(`${GT}/new_pools?page=${p}`).catch(() => ({ data: [] }))));
    const seen = new Set();
    const rows = [];
    for (const p of pages.flatMap((x) => x.data || [])) {
      const a = p.attributes;
      const tok = (p.relationships?.base_token?.data?.id || "").split("_")[1];
      const ageMin = (Date.now() - Date.parse(a.pool_created_at)) / 60000;
      if (!tok || seen.has(tok) || ageMin > 60) continue;
      seen.add(tok);
      const tx = a.transactions?.h24 || {};
      const swaps = (tx.buys || 0) + (tx.sells || 0);
      const liq = Number(a.reserve_in_usd) || 0;
      const dex = DEXG[p.relationships?.dex?.data?.id] || "other";
      const { c } = cohort(dex, band(liq, T.bands.liq), band(swaps, T.bands.swaps));
      rows.push({ tok, sym: a.name.split(" / ")[0], ageMin, swaps, liq, dex, odds: pct(c[1], c[0]) });
    }
    rows.sort((x, y) => x.ageMin - y.ageMin);
    list.replaceChildren();
    for (const r of rows.slice(0, 16)) {
      const li = el("li", "od-baby");
      const btn = el("button");
      btn.type = "button";
      btn.title = `Price $${r.sym}`;
      const name = el("span", "od-bn");
      name.append(el("b", "", `$${r.sym}`), el("small", "", `${Math.max(1, Math.round(r.ageMin))} min old · ${DEX_LABEL[r.dex]}`));
      const facts = el("span", "od-bf", `${r.liq >= 1 ? usd(r.liq) : "liq n/a"} · ${r.swaps} swap${r.swaps === 1 ? "" : "s"}`);
      const meter = el("span", "od-bm");
      const bar = el("i");
      bar.style.width = `${r.odds}%`;
      bar.className = r.odds >= 60 ? "up" : r.odds <= 30 ? "down" : "";
      meter.append(bar);
      const odds = el("span", "od-bo");
      odds.append(el("b", "", String(r.odds)), el("small", "", "in 100"));
      btn.append(name, facts, meter, odds);
      btn.addEventListener("click", () => {
        $("od-address").value = r.tok;
        price(r.tok);
      });
      li.append(btn);
      list.append(li);
    }
    msg.hidden = rows.length > 0;
    msg.textContent = rows.length ? "" : "No new pools in the last hour, or the market data source is busy. Try Refresh in a minute.";
  } finally {
    $("od-refresh").disabled = false;
  }
}

// --- boot -----------------------------------------------------------------------------------------------------------
$("od-form").addEventListener("submit", (e) => {
  e.preventDefault();
  price($("od-address").value);
});
$("od-refresh").addEventListener("click", nursery);

(async () => {
  try {
    T = await getJSON(`${RAW}odds.json`);
    buildSeg();
    duel();
    draw(pick.dex, pick.liq, pick.swaps);
    table();
    const q = new URLSearchParams(location.search).get("address");
    if (q && isAddr(q)) {
      $("od-address").value = q;
      await price(q);
    }
    nursery();
  } catch {
    say("Could not read the actuarial table right now. Try again in a minute.");
  }
  document.documentElement.dataset.ready = "1";
})();
