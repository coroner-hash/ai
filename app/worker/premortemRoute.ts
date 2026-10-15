import { Hono } from "hono";
import { type Draft, premortem } from "./premortem";
import { overLimit } from "./ratelimit";
import { clientIp, hashIp, originAllowed } from "./request";

const MAX_BODY_BYTES = 40_000; // up to ~24 KB of contract source plus the form fields

export const premortemRoute = new Hono<{ Bindings: Env }>();

premortemRoute.post("/", async (c) => {
  if (!originAllowed(c)) return c.json({ error: "origin_not_allowed" }, 403);
  if (Number(c.req.header("content-length") ?? 0) > MAX_BODY_BYTES) return c.json({ error: "payload_too_large" }, 413);

  const ipHash = await hashIp(clientIp(c), c.env.IP_SALT);
  const { limited, retryAfter } = await overLimit(c.env.DB, `premortem:${ipHash}`, 20, 600);
  if (limited) {
    c.header("Retry-After", String(retryAfter));
    return c.json({ error: "rate_limited" }, 429);
  }

  const body = await c.req.json<Draft>().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_body" }, 400);
  const hasAnything = ["name", "symbol", "description", "source"].some((k) => typeof (body as Record<string, unknown>)[k] === "string" && ((body as Record<string, string>)[k] ?? "").trim() !== "") || body.teamAllocationPct !== undefined || body.liquidityLock !== undefined;
  if (!hasAnything) return c.json({ error: "empty_draft" }, 400);

  return c.json({ rule_baseline: true, verdict: premortem(body) });
});
