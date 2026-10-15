// End-to-end API checks with a throwaway wallet. Works against local dev or production.
// Usage: node scripts/e2e.mjs [baseUrl=http://localhost:5173]
// Waitlist success needs a real Turnstile token, so only its rejections are checked here;
// the owner tests the happy path from a real browser.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE = process.argv[2] ?? "http://localhost:5173";
const ORIGIN = { origin: BASE };
const account = privateKeyToAccount(generatePrivateKey());
let cookie = "";
let failed = 0;
let sawRateLimit = false;

async function call(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 429) sawRateLimit = true;
  const set = res.headers.get("set-cookie");
  if (set && /^[\w-]+_session=/.test(set)) cookie = set.split(";")[0];
  return { status: res.status, json: await res.json().catch(() => null) };
}

function expect(name, cond, got) {
  if (!cond) failed++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  → got ${JSON.stringify(got)}`}`);
}

let r = await call("GET", "/api/health");
expect("health: database reachable", r.status === 200 && r.json?.ok === true, r);

// Waitlist guards
r = await call("POST", "/api/waitlist", { email: "not-an-email", elapsedMs: 5000, turnstileToken: "x" }, ORIGIN);
expect("waitlist rejects a bad email", r.status === 400 && r.json?.error === "invalid_email", r);
r = await call("POST", "/api/waitlist", { email: "e2e@example.com", elapsedMs: 5000 }, ORIGIN);
expect("waitlist requires the captcha token", r.status === 400 && r.json?.error === "captcha_required", r);
r = await call("POST", "/api/waitlist", { email: "bot@example.com", website: "spam", elapsedMs: 5000 }, ORIGIN);
expect("honeypot gets a silent ok", r.status === 200 && r.json?.ok === true, r);
r = await call("POST", "/api/waitlist", { email: "e2e@example.com" }, { origin: "https://evil.example" });
expect("foreign origin blocked", r.status === 403, r);

// Wallet sign-in
r = await call("GET", "/api/auth/me");
expect("signed out at start", r.json?.address === null, r.json);

r = await call("POST", "/api/auth/nonce", { address: account.address }, ORIGIN);
expect("nonce issued with a SIWE message", r.status === 200 && r.json?.message?.includes("Nonce:"), r);
const message = r.json.message;

const forged = await account.signMessage({ message: message.replace("Sign in", "Sign  in") });
r = await call("POST", "/api/auth/verify", { message, signature: forged }, ORIGIN);
expect("forged signature rejected", r.status === 401 && r.json?.error === "bad_signature", r);

r = await call("POST", "/api/auth/verify", { message, signature: await account.signMessage({ message }) }, ORIGIN);
expect("nonce is single-use", r.status === 400 && r.json?.error === "nonce_expired", r);

r = await call("POST", "/api/auth/nonce", { address: account.address }, ORIGIN);
const message2 = r.json.message;
r = await call("POST", "/api/auth/verify", { message: message2, signature: await account.signMessage({ message: message2 }) }, ORIGIN);
expect("valid signature opens a session", r.status === 200 && r.json?.address === account.address.toLowerCase() && cookie, r);

r = await call("GET", "/api/auth/me");
expect("session cookie identifies the wallet", r.json?.address === account.address.toLowerCase(), r.json);

await call("POST", "/api/auth/logout", {}, ORIGIN);
r = await call("GET", "/api/auth/me");
expect("logout ends the session", r.json?.address === null, r.json);

if (sawRateLimit) {
  console.log('\nHint: the rate limit tripped (reruns within 10 min). Locally clear it with:\n  npx wrangler d1 execute <db> --local --command "DELETE FROM rate_limits"');
}
console.log(failed ? `\n${failed} failing` : "\nall e2e checks pass");
process.exit(failed ? 1 : 0);
