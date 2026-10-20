import "./fonts.js";
import "./landing.css";
import "./extra.css";
import "./fx.css";
import "./theme.css";
import "./menu.js";
import { wireWaitlist } from "./waitlist.js";
import { wireHero } from "./hero.js";
import { wireFx } from "./fx.js";

const form = document.querySelector("#w-form");
if (form) wireWaitlist(form);

const heroImg = document.querySelector(".hero-img");
if (heroImg) wireHero(heroImg);

wireFx();

// Copy the token contract (set at launch by scripts/set_ca.py).
document.querySelectorAll(".ca-copy").forEach((b) =>
  b.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(b.dataset.ca);
      b.textContent = "copied";
      setTimeout(() => (b.textContent = "copy"), 1500);
    } catch {
      b.textContent = "select it";
    }
  }),
);

// Mark readiness for tools/record-anim.mjs.
document.documentElement.dataset.ready = "1";
