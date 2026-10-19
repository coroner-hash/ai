import "../landing/fonts.js";
import "../landing/landing.css";
import "../check/check.css";
import "../premortem/premortem.css";
import "./autopsy.css";
import "../landing/theme.css";
import { plainWords } from "../landing/narr.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const RAW = "https://raw.githubusercontent.com/coroner-hash/ai/main/data/shards/";
const $ = (id) => document.getElementById(id);
const form = $("a-form"), input = $("a-address"), go = $("a-go"), msg = $("c-msg"), out = $("a-result");

const CAUSES = {
  lp_removed: "Liquidity pulled",
  bled_out: "Bled out",
  never_lived: "Never lived",
  clone: "Copy-cat",
};

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const say = (t) => { msg.hidden = !t; msg.textContent = t || ""; };
const usd = (v) => (v === null || v === undefined ? "n/a" : "$" + Math.round(v).toLocaleString("en-US"));

async function loadRecord(address) {
  const prefix = address.slice(2, 4).toLowerCase();
  const r = await fetch(`${RAW}${prefix}.json`, { cache: "no-cache" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(String(r.status));
  const list = (await r.json())[address.toLowerCase()];
  if (!list || !list.length) return null;
  return list.reduce((a, b) => ((b.first?.liq_usd ?? 0) > (a.first?.liq_usd ?? 0) ? b : a));
}

function compare(rec) {
  const rows = [
    ["Liquidity", rec.first.liq_usd, rec.outcome.liq_usd],
    ["24h volume", rec.first.vol_h24, rec.outcome.vol_h24],
  ];
  const tbl = el("div", "cmp");
  const head = el("div", "cmp-row cmp-head");
  const h = rec.outcome.age_h;
  head.append(el("span", "", ""), el("span", "", "First seen"), el("span", "", h ? `Re-checked at ${Math.round(h)} h` : "24 hours later"));
  tbl.append(head);
  for (const [label, a, b] of rows) {
    const r = el("div", "cmp-row");
    r.append(el("span", "cmp-k", label), el("span", "", usd(a)), el("span", "", usd(b)));
    tbl.append(r);
  }
  const swaps = (rec.outcome.buys_h24 ?? 0) + (rec.outcome.sells_h24 ?? 0);
  const r = el("div", "cmp-row");
  r.append(el("span", "cmp-k", "Swaps in 24h"), el("span", "", (rec.first.buys_h24 ?? 0) + (rec.first.sells_h24 ?? 0)), el("span", "", swaps));
  tbl.append(r);
  return tbl;
}

function render(d, rec) {
  out.replaceChildren();
  const v = d.verdict, f = d.facts;
  const dead = v.status === "dead";

  const head = el("div", "r-head");
  const t = el("div");
  t.append(el("p", "r-sym", f["token.symbol"] || rec.symbol || "Unknown token"), el("p", "r-name", f["token.name"] || d.address));
  head.append(t, el("span", `risk ${dead ? "risk-high" : "risk-low"}`, dead ? "DEAD" : "STILL TRADING"));
  out.append(head, el("p", "r-addr", d.address));

  if (dead) out.append(el("p", "cause", `Pattern: ${CAUSES[v.cause_pattern] || v.cause_pattern}`));
  out.append(el("h2", "r-h", "First seen vs re-check"), compare(rec));

  out.append(el("h2", "r-h", dead ? "What the numbers show" : "Flags"));
  const flags = el("div", "r-flags");
  if (!v.flags.length) flags.append(el("p", "r-none", "Not dead by our rule: it still has volume or swaps."));
  for (const x of v.flags) {
    const c = el("div", "flag");
    c.append(el("p", "flag-code", x.code), el("p", "", x.text), el("p", "flag-ev", "evidence: " + x.evidence_ids.join(", ")));
    flags.append(c);
  }
  out.append(flags);

  const notes = [
    `Pool created ${rec.created.replace("T", " ").replace("Z", " UTC")}. First seen by the collector, then re-checked at least 24 hours after launch (the exact hour is in the table header).`,
    `Confidence ${Math.round(v.confidence * 100)}%. Rule baseline, not the Coroner model.`,
  ];
  const ul = el("ul", "r-notes");
  for (const n of notes) ul.append(el("li", "", n));
  out.append(ul);
  out.append(plainWords(v));
  out.hidden = false;
}

async function run(address) {
  say("");
  out.hidden = true;
  if (!ADDRESS.test(address)) return say("That does not look like a token address (0x followed by 40 characters).");
  go.disabled = true;
  go.textContent = "Reading…";
  try {
    const rec = await loadRecord(address);
    if (!rec) return say("We have no 24-hour record for this token. The collector watches pools launched after 14 Oct 2026 and labels them a day later, so it may be too new, or older than the collector.");
    const res = await fetch("/api/autopsy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, record: { symbol: rec.symbol, created: rec.created, first: rec.first, outcome: rec.outcome } }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return render(body, rec);
    say({ rate_limited: "Too many runs from your network. Give it a few minutes.", chain_unavailable: "The chain is not answering right now. Try again in a minute." }[body.error] || "Something broke on our side. Try again.");
  } catch {
    say("Could not read the data. Check your connection and retry.");
  } finally {
    go.disabled = false;
    go.textContent = "Run autopsy";
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  run(input.value.trim());
});
document.querySelectorAll("[data-fill]").forEach((b) =>
  b.addEventListener("click", () => {
    input.value = b.dataset.fill;
    run(b.dataset.fill);
  }),
);
const q = new URLSearchParams(location.search).get("address");
if (q) {
  input.value = q;
  run(q);
}
document.documentElement.dataset.ready = "1";
