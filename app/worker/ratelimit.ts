/**
 * Fixed-window rate limit stored in D1. One UPSERT per request; returns true
 * when the caller is over the limit for the current window.
 */
export async function overLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ limited: boolean; retryAfter: number }> {
  const now = Math.floor(Date.now() / 1000);
  const window = Math.floor(now / windowSeconds);
  const expiresAt = (window + 1) * windowSeconds;

  const row = await db
    .prepare(
      `INSERT INTO rate_limits (bucket, hits, expires_at) VALUES (?1, 1, ?2)
       ON CONFLICT (bucket) DO UPDATE SET hits = hits + 1
       RETURNING hits`,
    )
    .bind(`${key}:${window}`, expiresAt)
    .first<{ hits: number }>();

  // Sweep expired buckets on a small fraction of requests instead of a cron.
  if (Math.random() < 0.02) {
    await db.prepare("DELETE FROM rate_limits WHERE expires_at < ?1").bind(now).run();
  }

  return { limited: (row?.hits ?? 0) > limit, retryAfter: expiresAt - now };
}
