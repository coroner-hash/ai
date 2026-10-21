// Mobile menu: a three-line button at the left of the header opens a drawer that slides in from the left.
// The drawer is appended to <body> (not the header) because the header's blur would otherwise trap fixed positioning.
const TOOLS = [
  ["/check", "Check a token"],
  ["/odds", "Odds"],
  ["/radar", "Clone Radar"],
  ["/premortem", "Pre-mortem"],
  ["/autopsy", "Autopsy"],
  ["/sentinel", "Sentinel"],
  ["/docs", "API and MCP"],
];
// Tools that launched recently get a highlight and a NEW badge in the header and the drawer.
const NEW_TOOLS = ["/odds", "/radar"];
const badge = () => { const b = document.createElement("span"); b.className = "new-tag"; b.textContent = "New"; return b; };

function tagNavLinks() {
  const links = document.querySelector(".nav-links");
  if (!links) return;
  const have = (href) => links.querySelector(`a[href="${href}"]`);
  // pages with a short static menu: add the new tools right after "Check a token"
  const anchor = have("/check");
  for (const [href, label] of TOOLS.filter(([h]) => NEW_TOOLS.includes(h)).reverse()) {
    if (have(href) || !anchor) continue;
    const a = document.createElement("a");
    a.href = href;
    a.textContent = label;
    anchor.after(a);
  }
  for (const href of NEW_TOOLS) {
    const a = have(href);
    if (a && !a.classList.contains("is-new")) { a.classList.add("is-new"); a.append(badge()); }
  }
}

const HOME = [
  ["/#model", "Model"],
  ["/#how", "How it works"],
  ["/#status", "Roadmap"],
];
const LINKS = [
  ["https://huggingface.co/coronerai/coroner-31b", "Hugging Face", true],
  ["https://github.com/coroner-hash/ai", "GitHub", true],
  ["https://x.com/useCoronerAI", "X · @useCoronerAI", true],
];

export function wireMenu() {
  tagNavLinks();
  const nav = document.querySelector(".nav");
  if (!nav || document.getElementById("m-drawer")) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "menu-btn";
  btn.setAttribute("aria-label", "Open menu");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", "m-drawer");
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  nav.prepend(btn);

  const backdrop = document.createElement("div");
  backdrop.className = "m-backdrop";
  backdrop.hidden = true;

  const drawer = document.createElement("aside");
  drawer.id = "m-drawer";
  drawer.className = "m-drawer";
  drawer.setAttribute("aria-label", "Menu");
  drawer.setAttribute("aria-hidden", "true");
  drawer.inert = true;

  const head = document.createElement("div");
  head.className = "m-head";
  head.innerHTML = '<span class="brand"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 9h18M3 15h18" stroke="currentColor" stroke-width="1.8"/><circle cx="16.5" cy="12" r="1.5" fill="#e5322d"/></svg><span>Coroner</span></span>';
  const close = document.createElement("button");
  close.type = "button";
  close.className = "menu-close";
  close.setAttribute("aria-label", "Close menu");
  close.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  head.append(close);
  drawer.append(head);

  const here = location.pathname.replace(/\/$/, "") || "/";
  const group = (title, items) => {
    const g = document.createElement("div");
    g.className = "m-group";
    const h = document.createElement("p");
    h.className = "m-title";
    h.textContent = title;
    g.append(h);
    for (const [href, label, ext] of items) {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = label;
      if (ext) { a.target = "_blank"; a.rel = "noreferrer"; a.className = "m-ext"; }
      if (href === here) a.setAttribute("aria-current", "page");
      if (NEW_TOOLS.includes(href)) { a.classList.add("is-new"); a.append(badge()); }
      g.append(a);
    }
    return g;
  };
  drawer.append(group("Tools", TOOLS), group("Learn", HOME), group("Links", LINKS));
  const note = document.createElement("p");
  note.className = "m-note";
  note.textContent = "Rule-based today. Not financial advice.";
  drawer.append(note);
  document.body.append(backdrop, drawer);

  const open = () => {
    backdrop.hidden = false;
    requestAnimationFrame(() => document.documentElement.classList.add("menu-open"));
    drawer.inert = false;
    drawer.setAttribute("aria-hidden", "false");
    btn.setAttribute("aria-expanded", "true");
    document.documentElement.style.overflow = "hidden";
    close.focus();
  };
  const shut = (returnFocus = true) => {
    document.documentElement.classList.remove("menu-open");
    drawer.inert = true;
    drawer.setAttribute("aria-hidden", "true");
    btn.setAttribute("aria-expanded", "false");
    document.documentElement.style.overflow = "";
    setTimeout(() => { backdrop.hidden = true; }, 260);
    if (returnFocus) btn.focus();
  };
  btn.addEventListener("click", open);
  close.addEventListener("click", () => shut());
  backdrop.addEventListener("click", () => shut());
  drawer.addEventListener("click", (e) => { if (e.target.closest("a")) shut(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.documentElement.classList.contains("menu-open")) shut(); });
  matchMedia("(min-width: 861px)").addEventListener("change", (e) => { if (e.matches && document.documentElement.classList.contains("menu-open")) shut(false); });
}

wireMenu();
