// Public API v1: stable, documented aliases of the beta endpoints, with CORS, a plain-language narrative
// and an explicit statement of what produced the answer. Stateless, no cookies, rate-limited per IP.
import { Hono } from "hono";
import { cors } from "hono/cors";
import { autopsyRoute } from "./autopsyRoute";
import { narrate } from "./narrator";
import { openapi } from "./openapi";
import { premortemRoute } from "./premortemRoute";
import { verdict } from "./verdictRoute";

export const v1 = new Hono<{ Bindings: Env }>();

v1.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["content-type"], maxAge: 86400 }));

// Add `engine` and a narrative to every successful JSON answer.
v1.use("*", async (c, next) => {
  await next();
  const type = c.res.headers.get("content-type") ?? "";
  if (c.res.status !== 200 || !type.includes("application/json") || c.req.path.endsWith("openapi.json")) return;
  const body = (await c.res.clone().json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || !body.verdict) return;
  const out = { api_version: "v1", engine: "rules", model: null, ...body, narrative: narrate(body.verdict as never) };
  const headers = new Headers(c.res.headers);
  headers.delete("content-length");
  c.res = new Response(JSON.stringify(out), { status: 200, headers });
});

v1.get("/", (c) =>
  c.json({
    name: "Coroner API",
    version: "v1",
    engine: "rules",
    note: "Answers come from the open rule engine today. The model is not serving this API yet; the response will say so when it does.",
    docs: "https://coronerai.pro/docs",
    openapi: "https://coronerai.pro/api/v1/openapi.json",
    endpoints: ["GET /api/v1/verdict/{address}", "POST /api/v1/verdict", "POST /api/v1/premortem", "POST /api/v1/autopsy"],
  }),
);
v1.get("/openapi.json", (c) => c.json(openapi));

v1.route("/verdict", verdict);
v1.route("/premortem", premortemRoute);
v1.route("/autopsy", autopsyRoute);
