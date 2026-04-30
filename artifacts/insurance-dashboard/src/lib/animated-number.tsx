import { useEffect, useRef, useState } from "react";

/**
 * Detects the user's `prefers-reduced-motion` setting and reacts to live
 * changes. Returned synchronously so consumers can short-circuit animations
 * on the very first render.
 */
function usePrefersReducedMotion(): boolean {
  const get = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const [reduced, setReduced] = useState<boolean>(get);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = () => setReduced(mq.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);

  return reduced;
}

/**
 * useAnimatedNumber — counts from the currently displayed value up (or down)
 * to `target` over `duration` ms with an easeOutCubic curve. Re-runs whenever
 * `target` changes and resumes from the current frame's value so mid-flight
 * target changes don't snap back to zero. Skips animation entirely when the
 * user prefers reduced motion or the target is non-finite. Cancels cleanly on
 * unmount so we never leak rAFs in dashboards with many cards.
 */
export function useAnimatedNumber(target: number, duration = 1100): number {
  const reducedMotion = usePrefersReducedMotion();
  const [value, setValue] = useState<number>(() => (Number.isFinite(target) ? 0 : target));
  // Tracks the most recently rendered numeric value so a mid-animation target
  // change starts from where we currently are, not the previous final value.
  const currentRef = useRef<number>(0);

  useEffect(() => {
    if (!Number.isFinite(target)) {
      currentRef.current = 0;
      setValue(target);
      return;
    }
    if (reducedMotion) {
      currentRef.current = target;
      setValue(target);
      return;
    }
    const from = currentRef.current;
    const delta = target - from;
    if (delta === 0) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const next = from + delta * eased;
      currentRef.current = next;
      setValue(next);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reducedMotion]);

  return value;
}

interface AnimatedNumberProps {
  value: number;
  format: (n: number) => string;
  duration?: number;
  className?: string;
}

/**
 * Renders an animated count-up of `value`. The display is formatted on every
 * frame via the supplied `format` callback so we never lose currency/percent
 * styling during the animation. Non-finite values render via `format(value)`
 * directly (no animation, no NaN/Infinity leakage).
 */
export function AnimatedNumber({ value, format, duration = 1100, className }: AnimatedNumberProps) {
  const animated = useAnimatedNumber(value, duration);
  const display = Number.isFinite(animated) ? format(animated) : format(value);
  return <span className={className}>{display}</span>;
}
