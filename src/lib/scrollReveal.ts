const SCROLL_REVEAL_SELECTOR = '[data-scroll-reveal]';

export function initScrollReveal(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const elements = document.querySelectorAll<HTMLElement>(SCROLL_REVEAL_SELECTOR);

  if (elements.length === 0 || !('IntersectionObserver' in window)) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!(entry.target instanceof HTMLElement)) return;

        const state = entry.isIntersecting ? 'visible' : 'hidden';
        entry.target.dataset.scrollRevealState = state;
      });
    },
    { threshold: 0 },
  );

  elements.forEach((element) => observer.observe(element));
  document.documentElement.setAttribute('data-scroll-reveal-ready', '');
}
