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

// Mark readiness for tools/record-anim.mjs.
document.documentElement.dataset.ready = "1";
