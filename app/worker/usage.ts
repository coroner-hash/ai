// Daily usage counters: how many verdicts, pre-mortems, autopsies, Sentinel sign-ups and waitlist submissions were served,
// split by where they came from (web, api, mcp). Counts only: no addresses, no IPs, no emails.
import type { Context, Next } from "hono";

type Kind = "verdict" | "premortem" | "autopsy" | "sentinel_watch" | "sentinel_confirmed" | "waitlist";

function kindOf(method: string, path: string): Kind | null {
  const p = path.replace(/^\/api\/v1/, "/api");
  if (p.startsWith("/api/verdict")) return "verdict";
  if (p.startsWith("/api/premortem") && method === "POST") return "premortem";
  if (p.startsWith("/api/autopsy") && method === "POST") return "autopsy";
  if (p === "/api/sentinel/watch" && method === "POST") return "sentinel_watch";
  if (p === "/api/sentinel/confirm") return "sentinel_confirmed";
  if (p === "/api/waitlist" && method === "POST") return "waitlist";
  return null;
}

export async function countUsage(c: Context<any>, next: Next) {
  await next();
  const kind = kindOf(c.req.method, c.req.path);
  if (!kind) return;
  const ok = kind === "sentinel_confirmed" ? (c.res.headers.get("location") ?? "").endsWith("#confirmed") : c.res.status === 200;
  if (!ok) return;
  const source = c.req.path.startsWith("/api/v1/") ? ((c.req.header("user-agent") ?? "").includes("coroner-mcp") ? "mcp" : "api") : "web";
  const day = new Date().toISOString().slice(0, 10);
  c.executionCtx.waitUntil(
    c.env.DB.prepare("INSERT INTO usage_daily (day, kind, n) VALUES (?1, ?2, 1) ON CONFLICT (day, kind) DO UPDATE SET n = n + 1")
      .bind(day, `${kind}:${source}`)
      .run()
      .catch((err: unknown) => console.error(JSON.stringify({ event: "usage_count_failed", err: String(err) }))),
  );
}

/** Public, aggregate-only usage for the last `days` days. */
export async function usageStats(db: D1Database, days = 14) {
  const rows = await db
    .prepare("SELECT day, kind, n FROM usage_daily WHERE day >= date('now', ?1) ORDER BY day DESC, kind")
    .bind(`-${days - 1} days`)
    .all<{ day: string; kind: string; n: number }>();
  const byDay: Record<string, Record<string, number>> = {};
  const totals: Record<string, number> = {};
  for (const r of rows.results ?? []) {
    (byDay[r.day] ??= {})[r.kind] = r.n;
    const k = r.kind.split(":")[0];
    totals[k] = (totals[k] ?? 0) + r.n;
  }
  return { since: Object.keys(byDay).sort()[0] ?? null, days, totals, by_day: byDay, note: "Counts of successful requests only. Days are UTC. Counting started 20 Oct 2026 (UTC)." };
}
