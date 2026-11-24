// Scroll a change into the part of the viewport that the fixed review bar does not cover,
// focus it and briefly highlight it (a static outline when reduced motion is preferred).

export function reviewBarHeight(): number {
  const bar = document.querySelector<HTMLElement>(".review-bar");
  return bar ? bar.getBoundingClientRect().height : 0;
}

export function revealAboveBar(el: HTMLElement): void {
  const visible = window.innerHeight - reviewBarHeight();
  const rect = el.getBoundingClientRect();
  const offset = Math.max(16, (visible - rect.height) / 3);
  window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - offset), behavior: "auto" });
  el.focus({ preventScroll: true });
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
}
