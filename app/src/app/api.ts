export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string; detail?: string };

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<Result<T>> {
  try {
    const res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, data: json as T };
    return { ok: false, status: res.status, error: json.error ?? "unknown", detail: json.detail };
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
}

export const get = <T>(path: string) => call<T>("GET", path);
export const post = <T>(path: string, body: unknown = {}) => call<T>("POST", path, body);

/** Human copy for every error code the API can return. Add one line per new code. */
export const ERRORS: Record<string, string> = {
  network: "Couldn't reach Coroner. Check your connection and try again.",
  internal: "Something broke on our side. Try again.",
  rate_limited: "Too many requests. Wait a minute and try again.",
  not_signed_in: "Your session ended. Sign in with your wallet again.",
  origin_not_allowed: "This action only works on coronerai.pro.",
  invalid_address: "That isn't a valid address (0x + 40 hex characters).",
  chain_unavailable: "The chain didn't answer in time. Try again in a moment.",
  message_rejected: "The sign-in message didn't match this site. Try again.",
  nonce_expired: "The sign-in request expired. Try again.",
  bad_signature: "The signature didn't match your wallet. Try again.",
  user_rejected: "You cancelled the request in your wallet.",
  wallet_error: "Your wallet returned an error. Unlock it and try again.",
  no_account: "Your wallet didn't share an account. Unlock it and try again.",
  no_wallet: "No browser wallet found. Install Rabby or MetaMask, or open this page in your wallet app's browser.",
};

export const errorText = (code: string) => ERRORS[code] ?? ERRORS.internal;
