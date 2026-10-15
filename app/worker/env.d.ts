interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Comma-separated origins allowed to call state-changing endpoints. */
  ALLOWED_ORIGINS: string;
  /** Optional dedicated RPC (e.g. Alchemy). Secret: it contains an API key. */
  RPC_URL?: string;
  /** Optional second provider (fallback), e.g. Alchemy. Secret. */
  RPC_URL_2?: string;
  /** Secrets — set with `wrangler secret put`, locally in .dev.vars. */
  TURNSTILE_SECRET: string;
  IP_SALT: string;
  /** Optional: waitlist confirmation emails are skipped (not failed) when unset. */
  RESEND_API_KEY?: string;
}
