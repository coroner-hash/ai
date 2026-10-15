// SMIL animations (the travelling dots) ignore CSS timing, so slow them here when the user prefers reduced motion.
export function wireFx() {
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const el of document.querySelectorAll(".fx animateMotion, .fx animate")) el.setAttribute("dur", "4s");
}
