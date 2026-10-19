import "../landing/fonts.js";
import "../landing/landing.css";
import "./check.css";
import "../landing/theme.css";
import "../premortem/premortem.css";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BS = "https://robinhoodchain.blockscout.com/api/v2";
const GT = "https://api.geckoterminal.com/api/v2/networks/robinhood";
const DEAD = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]);

const $ = (id) => document.getElementById(id);
const form = $("c-form"), input = $("c-address"), go = $("c-go"), msg = $("c-msg"), out = $("c-result");

function say(text) {
  msg.hidden = !text;
  msg.textContent = text || "";
}

async function getJSON(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

// Market and holder facts are read in the visitor's browser: those services block server egress.
async function readExt(address) {
  const [tok, hold, pools] = await Promise.allSettled([
    getJSON(`${BS}/tokens/${address}`),
    getJSON(`${BS}/tokens/${address}/holders`),
    getJSON(`${GT}/tokens/${address}/pools`),
  ]);
  const ext = {};
  const gaps = [];

  if (pools.status === "fulfilled") {
    const list = pools.value.data ?? [];
    ext.market = { poolCount: list.length };
    if (list.length) {
      const top = list.reduce((a, b) => (Number(b.attributes.reserve_in_usd) > Number(a.attributes.reserve_in_usd) ? b : a)).attributes;
      const tx = top.transactions?.h24 ?? {};
      Object.assign(ext.market, {
        topPoolName: top.name,
        poolCreated: top.pool_created_at,
        liqUsd: Number(top.reserve_in_usd),
        vol24Usd: Number(top.volume_usd?.h24),
        fdvUsd: top.fdv_usd ? Number(top.fdv_usd) : null,
        buys24: tx.buys ?? null,
        sells24: tx.sells ?? null,
      });
    }
  } else gaps.push("market");

  if (tok.status === "fulfilled" && hold.status === "fulfilled" && tok.value.total_supply) {
    const supply = BigInt(tok.value.total_supply);
    const items = (hold.value.items ?? []).filter((h) => !DEAD.has(String(h.address?.hash).toLowerCase()));
    const pct = (v) => (supply > 0n ? Number((BigInt(v) * 10000n) / supply) / 100 : null);
    const top10 = items.slice(0, 10).reduce((s, h) => s + BigInt(h.value), 0n);
    ext.holders = {
      count: Number(tok.value.holders_count ?? tok.value.holders ?? NaN),
      top1Pct: items[0] ? pct(items[0].value) : null,
      top10Pct: pct(top10),
      top1IsContract: items[0] ? Boolean(items[0].address?.is_contract) : null,
      top1Address: items[0]?.address?.hash ?? null,
    };
  } else gaps.push("holders");
  return { ext, gaps };
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

function fmt(v) {
  if (v === null || v === undefined) return "n/a";
  if (typeof v === "number") return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return String(v);
}

function render(d, gaps) {
  out.replaceChildren();
  const v = d.verdict, f = d.facts;

  const head = el("div", "r-head");
  const title = el("div");
  title.append(el("p", "r-sym", f["token.symbol"] || "Unknown token"), el("p", "r-name", f["token.name"] || d.address));
  const badge = el("span", `risk risk-${v.risk_class}`, v.risk_class.toUpperCase());
  head.append(title, badge);
  out.append(head);

  out.append(el("p", "r-addr", d.address));

  const flags = el("div", "r-flags");
  if (!v.flags.length) flags.append(el("p", "r-none", "No flags from the checks that could run."));
  for (const x of v.flags) {
    const card = el("div", "flag");
    card.append(el("p", "flag-code", x.code), el("p", "", x.text), el("p", "flag-ev", "evidence: " + x.evidence_ids.join(", ")));
    flags.append(card);
  }
  out.append(el("h2", "r-h", "Flags"), flags);

  const keys = ["contract.selector_mint", "contract.owner", "contract.owner_renounced", "contract.proxy_implementation", "token.supply", "holders.count", "holders.top1_pct", "holders.top10_pct", "market.liq_usd", "market.vol_h24_usd", "market.top_pool_age_hours"];
  const dl = el("dl", "facts");
  for (const k of keys) {
    if (f[k] === undefined) continue;
    const row = el("div");
    row.append(el("dt", "", k), el("dd", "", fmt(f[k])));
    dl.append(row);
  }
  out.append(el("h2", "r-h", "Facts used"), dl);

  const notes = [...(d.notes || [])];
  if (gaps.length) notes.push(`Your browser could not read ${gaps.join(" and ")} data, so those checks were skipped.`);
  notes.push(`Confidence ${Math.round(v.confidence * 100)}%. Rule baseline, not the Coroner model.`);
  const ul = el("ul", "r-notes");
  for (const n of notes) ul.append(el("li", "", n));
  out.append(ul);
  out.hidden = false;
}

async function run(address) {
  say("");
  out.hidden = true;
  if (!ADDRESS.test(address)) return say("That does not look like a token address (0x followed by 40 characters).");
  go.disabled = true;
  go.textContent = "Reading…";
  try {
    const { ext, gaps } = await readExt(address);
    const res = await fetch("/api/verdict", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, ext }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return render(body, gaps);
    say(
      {
        rate_limited: "Too many checks from your network. Give it a few minutes.",
        not_a_contract: "There is no contract at that address on Robinhood Chain.",
        chain_unavailable: "The chain is not answering right now. Try again in a minute.",
        invalid_address: "That does not look like a token address.",
      }[body.error] || "Something broke on our side. Try again.",
    );
  } catch {
    say("Could not reach the server. Check your connection and retry.");
  } finally {
    go.disabled = false;
    go.textContent = "Get verdict";
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
