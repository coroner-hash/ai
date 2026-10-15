// Gentle depth for the hero photo: it leans toward the pointer and breathes slowly.
// Under reduced motion the movement is slowed, never removed.
export function wireHero(img) {
  const hero = img.closest(".hero");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const speed = reduced ? 0.3 : 1;
  let tx = 0, ty = 0, x = 0, y = 0, t = 0, last = performance.now();
  let visible = true, awake = true;

  addEventListener("pointermove", (e) => {
    tx = (e.clientX / innerWidth - 0.5) * 2;
    ty = (e.clientY / innerHeight - 0.5) * 2;
  }, { passive: true });
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(hero);
  document.addEventListener("visibilitychange", () => (awake = !document.hidden));

  function tick(now) {
    requestAnimationFrame(tick);
    if (!visible || !awake) { last = now; return; }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; t += dt * speed;
    x += (tx - x) * 0.05 * speed + (tx - x) * 0.01;
    y += (ty - y) * 0.05 * speed + (ty - y) * 0.01;
    const s = 1.09 + Math.sin(t * 0.18) * 0.014;
    // On wide screens, sit the photo lower so the pulled-out drawer lands beside the buttons, not under the headline.
    const base = hero.clientWidth / hero.clientHeight > 1.3 ? hero.clientHeight * 0.075 : 0;
    img.style.transform = `translate3d(${(-x * 34 + Math.sin(t * 0.11) * 6).toFixed(2)}px, ${(base - y * 20).toFixed(2)}px, 0) scale(${s.toFixed(4)})`;
  }
  requestAnimationFrame(tick);
}
