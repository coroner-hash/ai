import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/jetbrains-mono";
import "./landing.css";
import "./extra.css";
import "./fx.css";
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
