// Coroner on Telegram. Webhook bot:
//   private chat: any message containing a token address -> verdict
//   groups:       /check <CA> or a message that mentions the bot (never answers unprompted)
//   /autopsy <CA> -> what happened to a pool our open collector watched for 24 hours
// Off unless TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET are set. The cron registers the webhook and the
// command menu once (settings.tg_webhook), so setup needs no manual API calls.
// The server cannot read holders (Blockscout blocks server egress), so every reply links to the full report.
import { buildAutopsy, type PoolRec, type PoolSnap } from "./autopsy";
import { overLimit } from "./ratelimit";
import { ChainUnavailable } from "./rpc";
import { bumpUsage } from "./usage";
import { buildVerdict, type Facts } from "./verdict";
import { cachedContractFacts } from "./verdictRoute";

const API = "https://api.telegram.org";
const SITE = "https://coronerai.pro";
const ADDRESS = /0x[a-fA-F0-9]{40}/;
const SHARDS = "https://raw.githubusercontent.com/coroner-hash/ai/main/data/shards";

const token = (env: Env) => (env.TELEGRAM_BOT_TOKEN ?? "").trim().replace(/^["']|["']$/g, "").replace(/^bot/i, "").trim();

async function tg(env: Env, method: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${API}/bot${token(env)}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json: any = await res.json().catch(() => ({}));
  if (!json.ok) console.error(JSON.stringify({ event: "tg_api_error", method, status: res.status, description: String(json.description ?? "").slice(0, 200) }));
  return json;
}

async function setting(db: D1Database, key: string): Promise<string | null> {
  const r = await db.prepare("SELECT value FROM settings WHERE key = ?1").bind(key).first<{ value: string }>();
  return r?.value ?? null;
}
async function setSetting(db: D1Database, key: string, value: string) {
  await db.prepare("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')").bind(key, value).run();
}

/** One-time setup from the cron: webhook with our secret, command menu, descriptions. Re-runs when the bot changes. */
export async function ensureTelegram(env: Env): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) return;
  const botId = token(env).split(":")[0];
  if ((await setting(env.DB, "tg_webhook")) === `${botId}:1`) return;
  const me = await tg(env, "getMe", {});
  if (!me.ok) return;
  const hook = await tg(env, "setWebhook", { url: `${SITE}/api/tg/webhook`, secret_token: env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ["message"], drop_pending_updates: true });
  if (!hook.ok) return;
  await tg(env, "setMyCommands", {
    commands: [
      { command: "check", description: "Verdict for a Robinhood Chain token: /check 0x…" },
      { command: "autopsy", description: "What happened to a token we watched: /autopsy 0x…" },
      { command: "help", description: "How Coroner works" },
    ],
  });
  await tg(env, "setMyDescription", { description: "Coroner reads a Robinhood Chain token's contract and market and replies with a verdict, every flag tied to its evidence. Free, no wallet. Risk classification, not financial advice." });
  await tg(env, "setMyShortDescription", { short_description: "Paste a Robinhood Chain CA, get the verdict. coronerai.pro" });
  await setSetting(env.DB, "tg_username", me.result.username);
  await setSetting(env.DB, "tg_webhook", `${botId}:1`);
  console.log(JSON.stringify({ event: "tg_ready", username: me.result.username }));
}

const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usd = (n: unknown) => (typeof n !== "number" || !isFinite(n) ? "n/a" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`);

const SYMBOLS = "https://raw.githubusercontent.com/coroner-hash/ai/main/data/symbols.json";
const DEX_LABEL: Record<string, string> = { "pons-v2": "Pons (on the curve)", "pons-v2-dex": "Pons (graduated)", "uniswap-v4-robinhood": "Uniswap v4", "uniswap-v3-robinhood": "Uniswap v3", "uniswap-v2-robinhood": "Uniswap v2", "bankr-robinhood": "Bankr", "clanker-robinhood": "Clanker", "virtuals-robinhood": "Virtuals" };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
const ago = (iso: string) => {
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
};

type SymEntry = [string, string, string | null, number | null, number | null]; // token, first seen, dex, first liq, first 24h vol

/** Open collector data, read from GitHub (cached at the edge for 10 minutes). Best effort. */
async function symbolIndex(): Promise<Record<string, SymEntry[]> | null> {
  try {
    const r = await fetch(SYMBOLS, { signal: AbortSignal.timeout(8000), cf: { cacheTtl: 600, cacheEverything: true } } as RequestInit);
    return r.ok ? ((await r.json()) as Record<string, SymEntry[]>) : null;
  } catch {
    return null;
  }
}

async function shardRecords(address: string): Promise<any[]> {
  try {
    const r = await fetch(`${SHARDS}/${address.slice(2, 4)}.json`, { signal: AbortSignal.timeout(6000), cf: { cacheTtl: 600, cacheEverything: true } } as RequestInit);
    const shard: Record<string, any[]> = r.ok ? await r.json() : {};
    return (shard[address] ?? []).filter((x) => x.first && x.outcome).sort((x, y) => String(x.created).localeCompare(String(y.created)));
  } catch {
    return [];
  }
}

export function buttons(address: string) {
  return {
    inline_keyboard: [
      [{ text: "📄 Full report", url: `${SITE}/check?address=${address}` }, { text: "🧾 Autopsy", url: `${SITE}/autopsy?address=${address}` }],
      [{ text: "🛰 Watch this contract", url: `${SITE}/sentinel` }],
    ],
  };
}

export async function verdictText(env: Env, address: string): Promise<string> {
  const [{ facts }, index, history] = await Promise.all([cachedContractFacts(env, address), symbolIndex(), shardRecords(address)]);
  if (facts["contract.is_contract"] === false) return `⛔ <code>${address}</code> holds no contract code on Robinhood Chain. Check the address.`;
  const v = buildVerdict({ ...facts } as Facts, "live");
  const sym = String(facts["token.symbol"] ?? "").replace(/[^ -~]/g, "").trim().slice(0, 16) || "Token";
  const name = String(facts["token.name"] ?? "").replace(/[^ -~]/g, "").trim().slice(0, 32);
  const ok = (good: boolean) => (good ? "✅" : "⚠️");
  const stable = facts["token.category"] === "stablecoin";
  const ownerOk = facts["contract.owner_renounced"] === true || !facts["contract.owner"];
  const ownerTxt = facts["contract.owner_renounced"] === true ? "Ownership renounced" : facts["contract.owner"] ? `Owner active: <code>${short(String(facts["contract.owner"]))}</code>` : "No owner function";
  const contract = [
    `${ok(!facts["contract.selector_mint"] || stable)} ${facts["contract.selector_mint"] ? (stable ? "Mint function (expected for a stablecoin issuer)" : "Mint function: supply can grow") : "No mint function"}`,
    `${ok(!facts["contract.selector_blacklist"])} ${facts["contract.selector_blacklist"] ? "Blacklist: wallets can be blocked" : "No blacklist"}`,
    `${ok(!facts["contract.selector_pause"])} ${facts["contract.selector_pause"] ? "Pause: transfers can be halted" : "No pause"}`,
    `${ok(ownerOk)} ${ownerTxt}`,
    `${ok(!facts["contract.proxy_implementation"])} ${facts["contract.proxy_implementation"] ? "Upgradeable proxy: logic can change" : "Not upgradeable"}`,
  ].join("\n");
  const warns = [facts["contract.selector_mint"] && !stable, facts["contract.selector_blacklist"], facts["contract.selector_pause"], facts["contract.proxy_implementation"], !ownerOk].filter(Boolean).length;

  // Ticker: who else uses it, in our data since 14 Oct 2026
  let ticker = "Ticker check unavailable right now.";
  let mine: SymEntry | undefined;
  let copyCat = false;
  let shared = 0;
  if (index) {
    const entries = index[norm(sym)] ?? [];
    mine = entries.find((e) => e[0] === address);
    const others = entries.filter((e) => e[0] !== address);
    shared = mine ? others.length : entries.length;
    if (!others.length) ticker = `✅ No other token uses $${esc(sym)} in our data.`;
    else {
      const n = `${others.length} other token${others.length > 1 ? "s" : ""} use $${esc(sym)}`;
      const busiest = entries.reduce((x, y) => ((y[4] ?? 0) > (x[4] ?? 0) ? y : x));
      if (!mine) {
        // Not in our records: we cannot compare, so we only count.
        ticker = `⚠️ ${entries.length} token${entries.length > 1 ? "s" : ""} use $${esc(sym)} in our data (oldest first seen ${when(entries[0][1])}). Check the address, not the ticker.`;
      } else if (busiest[0] === address) {
        ticker = `⚠️ ${n}. This one was the most active when first seen${entries[0][0] === address ? ", and the oldest" : ""}. Check the address, not the ticker.`;
      } else {
        const olderBusier = others.find((e) => e[1] < mine![1] && (e[4] ?? 0) > (mine![4] ?? 0));
        copyCat = Boolean(olderBusier);
        ticker = olderBusier
          ? `🚩 <b>Copy-cat pattern.</b> ${n}, and an older one was busier:\n<code>${olderBusier[0]}</code> (first seen ${when(olderBusier[1])})`
          : `⚠️ ${n}. A more active one:\n<code>${busiest[0]}</code> (first seen ${when(busiest[1])})`;
      }
    }
  }

  // History from the open collector
  let hist = "Not in our records: we track pools created since 14 Oct 2026.";
  const firstSeen = mine?.[1] ?? history[0]?.created;
  if (firstSeen) {
    const dex = DEX_LABEL[mine?.[2] ?? history[0]?.dex ?? ""] ?? "a DEX";
    const lines = [`First pool ${ago(firstSeen)} on ${dex}, liquidity ${usd(mine?.[3] ?? history[0]?.first?.liq_usd)}`];
    const last = history[history.length - 1];
    if (last?.outcome) {
      const swaps = (last.outcome.buys_h24 ?? 0) + (last.outcome.sells_h24 ?? 0);
      const dead = (last.outcome.vol_h24 ?? 0) < 50 && swaps <= 2;
      lines.push(`24h later: ${swaps.toLocaleString("en-US")} swaps, ${usd(last.outcome.vol_h24)} volume → ${dead ? "⚫ dead by our rule" : "🟢 still trading"}`);
    } else lines.push("24-hour re-check still pending.");
    hist = lines.join("\n");
  }

  const dot = v.flags.some((f) => f.code === "mint_with_live_owner") || copyCat ? "🔴" : warns ? "🟡" : "⚪";
  const parts = [warns ? `${warns} contract flag${warns > 1 ? "s" : ""}` : "", copyCat ? "copy-cat ticker" : shared ? `ticker shared with ${shared} other token${shared > 1 ? "s" : ""}` : ""].filter(Boolean);
  const summary = parts.length ? `Worth a look: ${parts.join(" · ")}.` : "Nothing flagged in the contract or the ticker.";
  return [
    `${dot} <b>$${esc(sym)}</b>${name ? ` · ${esc(name)}` : ""}`,
    `<code>${address}</code>\n${summary}`,
    `<b>Contract</b>\n${contract}`,
    `<b>Ticker</b>\n${ticker}`,
    `<b>History</b> <i>(open collector)</i>\n${hist}`,
    `<i>Holders and the live market are in the full report. Rule-based reading of public on-chain data, not financial advice.</i>`,
  ].join("\n\n");
}

async function autopsyText(env: Env, address: string): Promise<string> {
  const r = await fetch(`${SHARDS}/${address.slice(2, 4)}.json`, { signal: AbortSignal.timeout(6000) });
  const shard: Record<string, any[]> = r.ok ? await r.json() : {};
  const recs = (shard[address] ?? []).filter((x) => x.first && x.outcome).sort((a, b) => String(b.created).localeCompare(String(a.created)));
  if (!recs.length) return `No autopsy record for <code>${address}</code> yet. Our collector re-checks pools 24 hours after they appear (since 14 Oct 2026). Try /check instead.`;
  const x = recs[0];
  const snap = (s: any): PoolSnap => ({ liq_usd: s.liq_usd ?? null, fdv_usd: s.fdv_usd ?? null, vol_h24: s.vol_h24 ?? null, buys_h24: s.buys_h24 ?? null, sells_h24: s.sells_h24 ?? null });
  const rec: PoolRec = { symbol: String(x.symbol ?? "").slice(0, 24), created: x.created, first: snap(x.first), outcome: snap(x.outcome) };
  const { facts } = await cachedContractFacts(env, address);
  const v = buildAutopsy(facts, rec);
  const sym = esc(rec.symbol || "Token");
  const status = v.status === "dead" ? `⚫ <b>$${sym} · DEAD</b> (pattern: ${esc(String(v.cause_pattern))})` : `🟢 <b>$${sym} · still trading</b> at the re-check`;
  return [status, `<code>${address}</code>`, v.flags.slice(0, 3).map((f: any) => `• ${esc(f.text)}`).join("\n") || "No flags.", `Full autopsy: ${SITE}/autopsy?address=${address}`, "<i>A pattern consistent with the numbers, never an accusation.</i>"].join("\n\n");
}

const HELP = [
  "<b>Coroner</b> reads a Robinhood Chain token and tells you what the contract allows and what the market shows. Every flag is tied to its evidence.",
  "Send a token address here, or use <code>/check 0x…</code>. In groups: <code>/check 0x…</code> or mention me.",
  "<code>/autopsy 0x…</code>: what happened to a pool our open collector watched for 24 hours.",
  `Full reports with holders: ${SITE}/check · Contract alerts by email: ${SITE}/sentinel`,
  "Free. Rule-based today. Risk classification, not financial advice.",
].join("\n\n");

export async function handleTelegramUpdate(env: Env, update: any, ctx: ExecutionContext): Promise<void> {
  const msg = update?.message;
  if (!msg || msg.from?.is_bot) return;
  const text: string = (msg.text ?? msg.caption ?? "").trim();
  if (!text) return;
  const chatId = msg.chat.id;
  const isPrivate = msg.chat.type === "private";
  const me = ((await setting(env.DB, "tg_username")) ?? "").toLowerCase();
  const lower = text.toLowerCase();
  const cmd = lower.match(/^\/(\w+)(@\w+)?/);
  if (cmd?.[2] && me && cmd[2].slice(1) !== me) return; // a command for another bot

  const reply = (body: string, markup?: unknown) => tg(env, "sendMessage", { chat_id: chatId, reply_to_message_id: msg.message_id, text: body, parse_mode: "HTML", disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}) });

  if (cmd && (cmd[1] === "start" || cmd[1] === "help")) {
    await tg(env, "sendMessage", { chat_id: chatId, text: HELP, parse_mode: "HTML", disable_web_page_preview: true });
    return;
  }
  const isAutopsy = cmd?.[1] === "autopsy";
  const addressed = isPrivate || cmd?.[1] === "check" || isAutopsy || (me && lower.includes(`@${me}`));
  if (!addressed) return;
  const hit = text.match(ADDRESS);
  if (!hit) {
    if (isPrivate || cmd) await reply("Send a Robinhood Chain token address, for example <code>/check 0x48af…2f31</code>");
    return;
  }

  const user = String(msg.from?.id ?? chatId);
  const rl = await overLimit(env.DB, `tg:${user}`, 8, 600);
  const rc = await overLimit(env.DB, `tgchat:${chatId}`, 30, 3600);
  if (rl.limited || rc.limited) {
    await reply("Too many checks in a short time. Try again in a few minutes.");
    return;
  }
  const address = hit[0].toLowerCase();
  await tg(env, "sendChatAction", { chat_id: chatId, action: "typing" });
  try {
    await reply(isAutopsy ? await autopsyText(env, address) : await verdictText(env, address), buttons(address));
    ctx.waitUntil(bumpUsage(env.DB, isAutopsy ? "autopsy:telegram" : "verdict:telegram"));
  } catch (err) {
    if (err instanceof ChainUnavailable) {
      await reply("Robinhood Chain did not answer just now. Try again in a minute.");
      return;
    }
    console.error(JSON.stringify({ event: "tg_check_failed", err: String(err).slice(0, 200) }));
    await reply(`Something broke on our side. The web version may work: ${SITE}/check?address=${address}`);
  }
}

/** POST /api/tg/webhook. Telegram sends our secret in a header; anything else is ignored. */
export async function telegramWebhook(c: any): Promise<Response> {
  if (!c.env.TELEGRAM_WEBHOOK_SECRET || c.req.header("x-telegram-bot-api-secret-token") !== c.env.TELEGRAM_WEBHOOK_SECRET) return c.json({ ok: false }, 401);
  const update = await c.req.json().catch(() => null);
  if (update) c.executionCtx.waitUntil(handleTelegramUpdate(c.env, update, c.executionCtx).catch((e: unknown) => console.error(JSON.stringify({ event: "tg_update_error", err: String(e).slice(0, 200) }))));
  return c.json({ ok: true });
}
