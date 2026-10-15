type SiteverifyResponse = { success: boolean; "error-codes"?: string[] };

export type TurnstileResult = "pass" | "fail" | "unavailable";

export async function verifyTurnstile(secret: string, token: string, ip: string): Promise<TurnstileResult> {
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  form.append("remoteip", ip);

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return "unavailable";
    const data = (await res.json()) as SiteverifyResponse;
    if (!data.success) {
      console.warn(JSON.stringify({ event: "turnstile_rejected", codes: data["error-codes"] }));
    }
    return data.success ? "pass" : "fail";
  } catch (err) {
    console.error(JSON.stringify({ event: "turnstile_unreachable", err: String(err) }));
    return "unavailable";
  }
}
