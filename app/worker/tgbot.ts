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
import { buildVerdict, mergeExt, type Ext, type Facts } from "./verdict";
import { cachedContractFacts } from "./verdictRoute";

const API = "https://api.telegram.org";
const SITE = "https://coronerai.pro";
const ADDRESS = /0x[a-fA-F0-9]{40}/;
const GT = "https://api.geckoterminal.com/api/v2/networks/robinhood";
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

/** Market facts from GeckoTerminal. Best effort: the API sometimes refuses cloud servers, then we say so. */
async function marketExt(address: string): Promise<Ext | null> {
  try {
    const r = await fetch(`${GT}/tokens/${address}/pools`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const list: any[] = ((await r.json()) as any).data ?? [];
    const market: NonNullable<Ext["market"]> = { poolCount: list.length };
    if (list.length) {
      const top = list.reduce((a, b) => (Number(b.attributes.reserve_in_usd) > Number(a.attributes.reserve_in_usd) ? b : a)).attributes;
      const tx = top.transactions?.h24 ?? {};
      Object.assign(market, { topPoolName: top.name, poolCreated: top.pool_created_at, liqUsd: Number(top.reserve_in_usd), vol24Usd: Number(top.volume_usd?.h24), fdvUsd: top.fdv_usd ? Number(top.fdv_usd) : null, buys24: tx.buys ?? null, sells24: tx.sells ?? null });
    }
    return { market };
  } catch {
    return null;
  }
}

const RISK_DOT: Record<string, string> = { low: "🟢", medium: "🟡", high: "🔴", dead: "⚫" };

export async function verdictText(env: Env, address: string): Promise<string> {
  const { facts } = await cachedContractFacts(env, address);
  if (facts["contract.is_contract"] === false) return `<b>${short(address)}</b> holds no contract code on Robinhood Chain. Check the address.`;
  const merged: Facts = { ...facts };
  const ext = await marketExt(address);
  mergeExt(merged, ext ?? undefined);
  const v = buildVerdict(merged, "live");
  const sym = String(merged["token.symbol"] ?? "").replace(/[^ -~]/g, "").trim().slice(0, 16) || "Token";
  const haveMarket = Boolean(ext?.market);
  // Without market and holder data this is a contract check, not an overall verdict; say so in the headline.
  const scope = haveMarket ? "contract + market" : "contract check";
  const head = v.flags.length ? `${RISK_DOT[v.risk_class] ?? ""} <b>$${esc(sym)} · ${scope}: ${v.risk_class.toUpperCase()}</b>` : `⚪ <b>$${esc(sym)} · ${scope}: no flags</b>`;
  const owner = merged["contract.owner_renounced"] === true ? "renounced" : merged["contract.owner"] ? short(String(merged["contract.owner"])) : "none found";
  const contractLines = [
    `Mint function: ${merged["contract.selector_mint"] ? "yes" : "no"}`,
    `Blacklist: ${merged["contract.selector_blacklist"] ? "yes" : "no"} · Pause: ${merged["contract.selector_pause"] ? "yes" : "no"}`,
    `Owner: ${owner} · Upgradeable proxy: ${merged["contract.proxy_implementation"] ? "yes" : "no"}`,
  ].join("\n");
  const lines = [
    head,
    `<code>${address}</code>`,
    v.flags.length ? v.flags.slice(0, 4).map((f) => `• ${esc(f.text)}`).join("\n") : contractLines,
    haveMarket ? (ext!.market!.poolCount ? `Liquidity ${usd(merged["market.liq_usd"])} · 24h volume ${usd(merged["market.vol_h24_usd"])}` : "No trading pool found.") : "",
    `Full verdict with market and holders: ${SITE}/check?address=${address}`,
    "<i>Rule-based reading of public on-chain data. Not an audit, not financial advice.</i>",
  ];
  return lines.filter(Boolean).join("\n\n");
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

  const reply = (body: string) => tg(env, "sendMessage", { chat_id: chatId, reply_to_message_id: msg.message_id, text: body, parse_mode: "HTML", disable_web_page_preview: true });

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
    await reply(isAutopsy ? await autopsyText(env, address) : await verdictText(env, address));
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
