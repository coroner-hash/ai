import "../landing/fonts.js";
import "../landing/landing.css";
import "../check/check.css";
import "../landing/theme.css";

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MESSAGES = {
  invalid_email: "That email doesn't look right.",
  invalid_address: "That is not a valid 0x token address.",
  rate_limited: "Too many tries from your network. Give it a few minutes.",
  captcha_required: "The spam check didn't finish. Refresh and try again.",
  captcha_failed: "The spam check didn't pass. Refresh and try again.",
  captcha_unavailable: "Our spam check is down for a moment. Try again in a minute.",
  too_many_watches: "That email already watches three tokens. Unsubscribe from one first.",
  email_unavailable: "Email sending is not available right now. Try again later.",
};
const HASH = {
  "#confirmed": "Confirmed. Sentinel is now watching that contract and will email you if it changes.",
  "#unsubscribed": "Done. You will not get further emails about that token.",
  "#invalid": "That link is not valid or has already been used.",
  "#not-a-contract": "That address holds no contract code, so there is nothing to watch.",
  "#try-again": "We could not reach the chain just now. Open the confirmation link again in a minute.",
};

const $ = (id) => document.getElementById(id);
const form = $("s-form"), msg = $("s-msg"), go = $("s-go");
const say = (t, ok = false) => {
  msg.hidden = !t;
  msg.textContent = t || "";
  msg.className = ok ? "c-msg s-ok" : "c-msg";
};
if (HASH[location.hash]) say(HASH[location.hash], location.hash === "#confirmed" || location.hash === "#unsubscribed");

let token = null, widgetId = null, broken = false;
const mountedAt = Date.now();
function loadTurnstile() {
  return new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("missing")));
    s.onerror = () => reject(new Error("blocked"));
    document.head.appendChild(s);
  });
}
loadTurnstile()
  .then((api) => {
    widgetId = api.render($("s-captcha"), { sitekey: SITE_KEY, appearance: "interaction-only", theme: "light", callback: (t) => (token = t), "expired-callback": () => (token = null), "error-callback": () => (broken = true) });
  })
  .catch(() => (broken = true));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("s-email").value.trim(), address = $("s-address").value.trim();
  if (!EMAIL.test(email)) return say(MESSAGES.invalid_email);
  if (!ADDRESS.test(address)) return say(MESSAGES.invalid_address);
  if (!token) return say(broken ? "The spam check couldn't load. Disable content blockers for this page and refresh." : "Running a quick spam check… press the button again in a second.");
  go.disabled = true;
  say("");
  try {
    const r = await fetch("/api/sentinel/watch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, address, website: $("s-trap").value, elapsedMs: Date.now() - mountedAt, turnstileToken: token }),
    });
    if (r.ok) {
      form.hidden = true;
      say("Check your inbox. We sent a confirmation link; nothing is watched until you click it.", true);
      return;
    }
    const body = await r.json().catch(() => ({}));
    say(MESSAGES[body.error] ?? "Something broke on our side. Try again.");
  } catch {
    say("Couldn't reach the server. Check your connection and retry.");
  } finally {
    go.disabled = false;
    token = null;
    if (widgetId !== null) window.turnstile?.reset(widgetId);
  }
});
