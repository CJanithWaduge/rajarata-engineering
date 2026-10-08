/**
 * Card tilt controller (Phase 7, T7.3).
 *
 * Hydrates every `[data-card-tilt]` surface with subtle 3D pointer tracking:
 * the cursor position is mapped to a clamped `rotateX` / `rotateY` range and
 * written as `--card-tilt-x` / `--card-tilt-y` CSS custom properties, which
 * the `.card-tilt` class in global.css consumes.
 *
 * Responsibility split:
 * - global.css defines the 3D context and the transition/fallback rules.
 * - this module only measures the pointer and writes the two custom props.
 *   It never touches layout or shadows, so the CSS stays the source of truth.
 *
 * Accessibility:
 * - Completely inert under `prefers-reduced-motion` (T7.5).
 * - Inert on touch-first / coarse-pointer devices (T7.11) — tilt is a hover
 *   interaction and a stuck tilted card under a finger is worse than none.
 *
 * Performance:
 * - One rAF-paced listener chain per card; the transform update is batched
 *   to a single style write per frame.
 */

const TILT_SELECTOR = '[data-card-tilt]';
const DEFAULT_MAX_DEG = 5;
const MAX_DEG_ATTR = 'data-card-tilt-max';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const coarsePointer = window.matchMedia('(hover: none), (pointer: coarse)');

function isEligible(): boolean {
  return !reducedMotion.matches && !coarsePointer.matches;
}

export function initCardTilt(): void {
  if (!isEligible()) return;

  document.querySelectorAll<HTMLElement>(TILT_SELECTOR).forEach((card) => {
    const maxDeg = Number(card.getAttribute(MAX_DEG_ATTR)) || DEFAULT_MAX_DEG;

    let tracker: number | null = null;

    const setProps = (x: number, y: number) => {
      const rect = card.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      // Normalize to -0.5..0.5 relative to the card center, then scale to
      // the clamped ±maxDeg range. Sign flips put the top edge tilting away
      // and the left edge tilting toward the viewer under the cursor.
      const nx = (x - rect.left) / rect.width - 0.5;
      const ny = (y - rect.top) / rect.height - 0.5;

      const rotateY = nx * 2 * maxDeg;
      const rotateX = -ny * 2 * maxDeg;

      card.style.setProperty('--card-tilt-x', `${rotateX.toFixed(2)}deg`);
      card.style.setProperty('--card-tilt-y', `${rotateY.toFixed(2)}deg`);
    };

    const onMove = (e: PointerEvent) => {
      if (tracker !== null) return;
      tracker = window.requestAnimationFrame(() => {
        tracker = null;
        setProps(e.clientX, e.clientY);
      });
    };

    const onEnter = () => card.classList.add('is-tracking');
    const onLeave = () => {
      if (tracker !== null) {
        window.cancelAnimationFrame(tracker);
        tracker = null;
      }
      card.classList.remove('is-tracking');
      card.style.removeProperty('--card-tilt-x');
      card.style.removeProperty('--card-tilt-y');
    };

    card.addEventListener('pointerenter', onEnter);
    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerleave', onLeave);
  });
}