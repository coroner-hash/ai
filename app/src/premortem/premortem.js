import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/jetbrains-mono";
import "../landing/landing.css";
import "../check/check.css";
import "./premortem.css";

const GT_SEARCH = "https://api.geckoterminal.com/api/v2/search/pools?network=robinhood&query=";
const $ = (id) => document.getElementById(id);
const form = $("p-form"), go = $("p-go"), msg = $("c-msg"), out = $("p-result");

const PATTERNS = {
  lp_removed: "Liquidity pulled",
  dev_exit: "Quiet exit by large holders",
  hidden_privilege: "Owner powers that scanners flag",
  clone: "Read as a copy",
  never_lived: "Never gets a first buyer",
};

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const say = (t) => { msg.hidden = !t; msg.textContent = t || ""; };

// Ticker collisions come from the visitor's browser: GeckoTerminal blocks server egress.
async function findSimilar(symbol) {
  if (!symbol) return [];
  try {
    const r = await fetch(GT_SEARCH + encodeURIComponent(symbol), { headers: { accept: "application/json" } });
    if (!r.ok) return [];
    const best = new Map();
    for (const p of (await r.json()).data ?? []) {
      const base = String(p.relationships?.base_token?.data?.id ?? "").replace("robinhood_", "");
      const sym = String(p.attributes.name).split(" / ")[0];
      const vol = Number(p.attributes.volume_usd?.h24 ?? 0), liq = Number(p.attributes.reserve_in_usd ?? 0);
      if (!/^0x[0-9a-fA-F]{40}$/.test(base)) continue;
      const cur = best.get(base);
      if (!cur || vol > cur.vol24Usd) best.set(base, { symbol: sym, address: base, vol24Usd: vol, liqUsd: liq });
    }
    return [...best.values()].sort((a, b) => b.vol24Usd - a.vol24Usd).slice(0, 10);
  } catch {
    return [];
  }
}

function readForm() {
  const f = new FormData(form);
  const n = (k) => (f.get(k) === null || f.get(k) === "" ? undefined : Number(f.get(k)));
  const s = (k) => String(f.get(k) ?? "").trim();
  return {
    name: s("name"), symbol: s("symbol"), description: s("description"),
    buyTaxPct: n("buyTaxPct"), sellTaxPct: n("sellTaxPct"), teamAllocationPct: n("teamAllocationPct"),
    allocationSplit: s("allocationSplit") || undefined, liquidityUsd: n("liquidityUsd"), liquidityLock: s("liquidityLock") || undefined,
    taxChangeable: f.has("taxChangeable"), hasMint: f.has("hasMint"), ownerRenounce: f.has("ownerRenounce"),
    hasBlacklist: f.has("hasBlacklist"), hasPause: f.has("hasPause"),
    source: String(f.get("source") ?? ""),
  };
}

function diffBlock(diff) {
  const pre = el("pre", "diff");
  for (const line of diff.split("\n")) {
    const row = el("span", line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "", line + "\n");
    pre.append(row);
  }
  return pre;
}

function render(d, similarCount) {
  out.replaceChildren();
  const v = d.verdict;
  const head = el("div", "r-head");
  const t = el("div");
  t.append(el("p", "r-sym", "Pre-mortem"), el("p", "r-name", v.flags.length ? `${v.flags.length} thing${v.flags.length > 1 ? "s" : ""} to fix before launch` : "Nothing flagged by the checks that could run"));
  head.append(t, el("span", `risk risk-${v.risk_class}`, v.risk_class.toUpperCase()));
  out.append(head);

  if (v.exposure.length) {
    out.append(el("h2", "r-h", "How this draft could die"));
    const list = el("div", "r-flags");
    for (const e of v.exposure) {
      const c = el("div", "flag");
      c.append(el("p", "flag-code", PATTERNS[e.pattern] || e.pattern), el("p", "", e.why), el("p", "flag-ev", "pattern: " + e.pattern));
      list.append(c);
    }
    out.append(list);
  }

  out.append(el("h2", "r-h", "Flags"));
  const flags = el("div", "r-flags");
  if (!v.flags.length) flags.append(el("p", "r-none", "No flags from the checks that could run."));
  for (const f of v.flags) {
    const c = el("div", "flag");
    const top = el("div", "flag-top");
    top.append(el("p", "flag-code", f.code), el("span", `lv lv-${v.levels[f.code]}`, v.levels[f.code]));
    c.append(top, el("p", "", f.text), el("p", "flag-ev", "evidence: " + f.evidence_ids.join(", ")));
    flags.append(c);
  }
  out.append(flags);

  if (v.fixes.length) {
    out.append(el("h2", "r-h", "What to change"));
    const fl = el("div", "r-flags");
    for (const x of v.fixes) {
      const c = el("div", "flag fix");
      c.append(el("p", "flag-code", x.flag_code), el("p", "", x.suggestion));
      if (x.diff) c.append(diffBlock(x.diff));
      fl.append(c);
    }
    out.append(fl);
  }

  const notes = [];
  notes.push(similarCount ? `Compared your ticker with ${similarCount} existing token${similarCount > 1 ? "s" : ""} on Robinhood Chain.` : "No existing token with a similar ticker was found, or the market search could not be read.");
  notes.push(`Confidence ${Math.round(v.confidence * 100)}% (grows with how much of the draft you filled in). Rule baseline, not the Coroner model.`);
  const ul = el("ul", "r-notes");
  for (const n of notes) ul.append(el("li", "", n));
  out.append(ul);
  out.hidden = false;
  out.scrollIntoView({ behavior: "smooth", block: "start" });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  say("");
  const draft = readForm();
  go.disabled = true;
  go.textContent = "Reading…";
  try {
    draft.similar = await findSimilar(draft.symbol.toUpperCase());
    const res = await fetch("/api/premortem", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return render(body, draft.similar.length);
    say({ rate_limited: "Too many runs from your network. Give it a few minutes.", empty_draft: "Fill in at least one field, such as the name, a parameter or the source.", payload_too_large: "The draft is too large. Keep the source under 24 KB." }[body.error] || "Something broke on our side. Try again.");
  } catch {
    say("Could not reach the server. Check your connection and retry.");
  } finally {
    go.disabled = false;
    go.textContent = "Run pre-mortem";
  }
});
document.documentElement.dataset.ready = "1";
