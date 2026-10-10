const SCROLL_REVEAL_SELECTOR = '[data-scroll-reveal]';
const SCROLL_REVEAL_ITEM_SELECTOR = [
  'h1',
  'h2',
  'h3',
  'h4',
  'p',
  'a',
  'button',
  'li',
  'span:not(.material-symbols-outlined)',
  'strong',
  'em',
  '.card-interactive',
  '[data-card-tilt]',
  'img',
].join(',');

export function initScrollReveal(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const elements = document.querySelectorAll<HTMLElement>(SCROLL_REVEAL_SELECTOR);

  if (elements.length === 0 || !('IntersectionObserver' in window)) return;

  const revealTargets = new Set<HTMLElement>();
  elements.forEach((element) => {
    revealTargets.add(element);
    element.querySelectorAll<HTMLElement>(SCROLL_REVEAL_ITEM_SELECTOR).forEach((item) => {
      item.dataset.scrollRevealItem = '';
      revealTargets.add(item);
    });
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!(entry.target instanceof HTMLElement)) return;

        const rootTop = entry.rootBounds?.top ?? 0;
        const state = entry.isIntersecting
          ? 'visible'
          : entry.boundingClientRect.bottom <= rootTop
            ? 'hidden-up'
            : 'hidden-down';
        if (entry.target.dataset.scrollRevealState === state) return;

        entry.target.dataset.scrollRevealState = state;
      });
    },
    { threshold: 0 },
  );

  revealTargets.forEach((element) => {
    const bounds = element.getBoundingClientRect();
    const isVisible = bounds.top < window.innerHeight && bounds.bottom > 0;
    const state = isVisible ? 'visible' : bounds.bottom <= 0 ? 'hidden-up' : 'hidden-down';

    element.dataset.scrollRevealState = state;
    observer.observe(element);
  });

  document.documentElement.setAttribute('data-scroll-reveal-ready', '');
}
