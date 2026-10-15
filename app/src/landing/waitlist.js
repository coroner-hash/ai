// Connects the landing form to POST /api/waitlist.
// Spam defence is layered: Cloudflare Turnstile, a honeypot field, a minimum
// fill time, and a per-IP rate limit on the server.

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const MESSAGES = {
  invalid_email: "That email doesn't look right.",
  rate_limited: "Too many tries from your network. Give it a few minutes.",
  captcha_required: "The spam check didn't finish. Refresh the page and try again.",
  captcha_failed: "The spam check didn't pass. Refresh the page and try again.",
  captcha_unavailable: "Our spam check is down for a moment. Try again in a minute.",
  origin_not_allowed: "This form only works on coronerai.pro.",
};

function loadTurnstile() {
  return new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    script.onerror = () => reject(new Error("turnstile blocked"));
    document.head.appendChild(script);
  });
}

export function wireWaitlist(form) {
  const email = form.querySelector("#w-email");
  const button = form.querySelector("#w-join");
  const mountedAt = Date.now();
  let token = null;
  let widgetId = null;
  let captchaBroken = false;

  const status = document.createElement("p");
  status.id = "w-form-status";
  status.className = "w-form-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  form.append(status);
  email.setAttribute("aria-describedby", status.id);

  // Honeypot: off-screen, skipped by keyboard and screen readers, filled by bots.
  const trap = document.createElement("input");
  trap.name = "website";
  trap.tabIndex = -1;
  trap.autocomplete = "off";
  trap.setAttribute("aria-hidden", "true");
  trap.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;opacity:0";
  form.append(trap);

  const captchaSlot = document.createElement("div");
  captchaSlot.style.marginTop = "10px";
  form.append(captchaSlot);

  loadTurnstile()
    .then((api) => {
      widgetId = api.render(captchaSlot, {
        sitekey: SITE_KEY,
        appearance: "interaction-only",
        theme: "light",
        callback: (t) => (token = t),
        "expired-callback": () => (token = null),
        "error-callback": () => (captchaBroken = true),
      });
    })
    .catch(() => (captchaBroken = true));

  function say(message) {
    status.hidden = false;
    status.textContent = message;
  }

  async function submit() {
    const value = email.value.trim();
    if (!EMAIL.test(value)) {
      say(MESSAGES.invalid_email);
      email.focus();
      return;
    }
    if (!token) {
      say(
        captchaBroken
          ? "The spam check couldn't load. Disable content blockers for this page and refresh."
          : "Running a quick spam check… press Join again in a second.",
      );
      return;
    }

    const role = form.querySelector('input[name="w-role"]:checked')?.value ?? null;
    button.disabled = true;
    button.textContent = "Logging…";
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: value,
          role,
          website: trap.value,
          elapsedMs: Date.now() - mountedAt,
          turnstileToken: token,
        }),
      });
      if (res.ok) {
        form.querySelector(".w-field-row")?.setAttribute("hidden", "");
        form.querySelector(".w-roles")?.setAttribute("hidden", "");
        form.querySelector(".w-form-note")?.setAttribute("hidden", "");
        captchaSlot.hidden = true;
        say("You're on the list. One email at launch — nothing else.");
        return;
      }
      const body = await res.json().catch(() => ({}));
      say(MESSAGES[body.error] ?? "Something broke on our side. Try again.");
    } catch {
      say("Couldn't reach the server. Check your connection and retry.");
    } finally {
      button.disabled = false;
      button.textContent = "Join the waitlist";
    }
    token = null;
    if (widgetId !== null) window.turnstile?.reset(widgetId);
  }

  button.addEventListener("click", submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });
  email.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  });
}
