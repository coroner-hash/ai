import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { auth } from "./auth";
import { CHAIN_ID } from "./chain";
import { probeProvider, rpc } from "./rpc";
import { autopsyRoute } from "./autopsyRoute";
import { premortemRoute } from "./premortemRoute";
import { runSentinel, sentinel } from "./sentinel";
import { v1 } from "./v1";
import { verdict } from "./verdictRoute";
import type { AppEnv } from "./session";
import { waitlist } from "./waitlist";

const api = new Hono<AppEnv>();

api.use("*", secureHeaders());
api.use("*", async (c, next) => {
  await next();
  if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
});

api.get("/health", async (c) => {
  const db = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>().catch(() => null);
  return c.json({ ok: db?.ok === 1 }, db ? 200 : 503);
});

// Chain connectivity check: reports the latest block and whether a dedicated RPC (RPC_URL) is configured.
api.get("/chain", async (c) => {
  const which = c.req.query("provider");
  if (which === "1" || which === "2") return c.json(await probeProvider(c.env, which === "1" ? 1 : 2, Math.min(Number(c.req.query("logs") ?? 0) || 0, 2_000_000)));
  try {
    const hex = await rpc<string>(c.env, "eth_blockNumber", []);
    return c.json({ ok: Boolean(hex), chainId: CHAIN_ID, block: hex ? BigInt(hex).toString() : null, dedicatedRpc: Boolean(c.env.RPC_URL), fallbackRpc: Boolean(c.env.RPC_URL_2) });
  } catch {
    return c.json({ ok: false, chainId: CHAIN_ID, dedicatedRpc: Boolean(c.env.RPC_URL), fallbackRpc: Boolean(c.env.RPC_URL_2) }, 503);
  }
});

api.route("/v1", v1);
api.route("/verdict", verdict);
api.route("/premortem", premortemRoute);
api.route("/autopsy", autopsyRoute);
api.route("/waitlist", waitlist);
api.route("/sentinel", sentinel);
api.route("/auth", auth);

api.notFound((c) => c.json({ error: "not_found" }, 404));

const app = new Hono<AppEnv>();
app.route("/api", api);

app.onError((err, c) => {
  console.error(JSON.stringify({ event: "unhandled", path: c.req.path, err: err.stack ?? String(err) }));
  return c.req.path.startsWith("/api/") ? c.json({ error: "internal" }, 500) : c.text("Something broke on our side.", 500);
});

export default {
  fetch: app.fetch,
  // Every 30 minutes: Sentinel checks the watches that have waited longest.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runSentinel(env).then((r) => console.log(JSON.stringify({ event: "sentinel_run", ...r }))));
  },
};
