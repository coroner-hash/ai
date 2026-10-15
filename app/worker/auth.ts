import { Hono } from "hono";
import { getAddress, isAddress, verifyMessage, type Hex } from "viem";
import { createSiweMessage, generateSiweNonce, parseSiweMessage } from "viem/siwe";
import { CHAIN_ID, chainClient } from "./chain";
import { overLimit } from "./ratelimit";
import { clientIp, hashIp, originAllowed } from "./request";
import { endSession, sessionAddress, startSession, type AppEnv } from "./session";

const NONCE_SECONDS = 600;
const STATEMENT =
  "Sign in to Coroner. This is a signature, not a transaction: no gas, no approval, nothing leaves your wallet.";

export const auth = new Hono<AppEnv>();

auth.use("*", async (c, next) => {
  if (c.req.method !== "GET" && !originAllowed(c)) return c.json({ error: "origin_not_allowed" }, 403);
  const ipHash = await hashIp(clientIp(c), c.env.IP_SALT);
  const { limited, retryAfter } = await overLimit(c.env.DB, `auth:${ipHash}`, 30, 600);
  if (limited) {
    c.header("Retry-After", String(retryAfter));
    return c.json({ error: "rate_limited" }, 429);
  }
  await next();
});

// Step 1: the server writes the exact message, so domain, URI and chain can't be spoofed by the client.
auth.post("/nonce", async (c) => {
  const body = await c.req.json<{ address?: unknown }>().catch(() => null);
  const address = typeof body?.address === "string" ? body.address : "";
  if (!isAddress(address)) return c.json({ error: "invalid_address" }, 400);

  const url = new URL(c.req.url);
  const nonce = generateSiweNonce();
  const now = Date.now();
  await c.env.DB.prepare("INSERT INTO auth_nonces (nonce, address, expires_at) VALUES (?1, ?2, ?3)")
    .bind(nonce, address.toLowerCase(), Math.floor(now / 1000) + NONCE_SECONDS)
    .run();
  if (Math.random() < 0.05) {
    await c.env.DB.prepare("DELETE FROM auth_nonces WHERE expires_at < ?1").bind(Math.floor(now / 1000)).run();
  }

  const message = createSiweMessage({
    domain: url.host,
    address: getAddress(address),
    statement: STATEMENT,
    uri: url.origin,
    version: "1",
    chainId: CHAIN_ID,
    nonce,
    issuedAt: new Date(now),
    expirationTime: new Date(now + NONCE_SECONDS * 1000),
  });
  return c.json({ message });
});

// Step 2: check the signed message is ours, unused and unexpired, then open a session.
auth.post("/verify", async (c) => {
  const body = await c.req.json<{ message?: unknown; signature?: unknown }>().catch(() => null);
  const message = typeof body?.message === "string" ? body.message : "";
  const signature = typeof body?.signature === "string" ? body.signature : "";
  if (!message || !/^0x[0-9a-fA-F]+$/.test(signature)) return c.json({ error: "invalid_body" }, 400);

  const url = new URL(c.req.url);
  const fields = parseSiweMessage(message);
  if (
    fields.domain !== url.host ||
    fields.uri !== url.origin ||
    fields.chainId !== CHAIN_ID ||
    !fields.address ||
    !fields.nonce ||
    !fields.expirationTime ||
    fields.expirationTime.getTime() < Date.now()
  ) {
    return c.json({ error: "message_rejected" }, 400);
  }

  // Single use: delete the nonce whether or not the signature turns out valid.
  const nonceRow = await c.env.DB.prepare(
    "DELETE FROM auth_nonces WHERE nonce = ?1 AND address = ?2 AND expires_at > ?3 RETURNING nonce",
  )
    .bind(fields.nonce, fields.address.toLowerCase(), Math.floor(Date.now() / 1000))
    .first();
  if (!nonceRow) return c.json({ error: "nonce_expired" }, 400);

  const params = { address: fields.address, message, signature: signature as Hex };
  let valid = await verifyMessage(params).catch(() => false);
  if (!valid) {
    // Smart-contract wallets (ERC-1271 / ERC-6492) need an on-chain check.
    valid = await chainClient(c.env.RPC_URL).verifyMessage(params).catch(() => false);
  }
  if (!valid) return c.json({ error: "bad_signature" }, 401);

  await startSession(c, fields.address);
  return c.json({ address: fields.address.toLowerCase() });
});

auth.get("/me", async (c) => c.json({ address: await sessionAddress(c) }));

auth.post("/logout", async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});
