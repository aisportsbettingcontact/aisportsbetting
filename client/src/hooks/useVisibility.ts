/**
 * useVisibility — IntersectionObserver-gated visibility hook.
 *
 * Returns true once the element enters the viewport (with 200px root margin).
 * Once visible, stays true — no re-hiding. Used to gate tRPC queries for
 * below-fold secondary panels (OddsHistoryPanel, RecentSchedulePanel,
 * SituationalResultsPanel, BettingSplitsPanel) so they only fire when the
 * card enters the viewport.
 *
 * Architecture: Reduces initial page load from ~3,800 DOM nodes to ~760 DOM nodes
 * by deferring secondary panel data fetching until the card is visible.
 */
import { useState, useEffect, useRef, useCallback } from "react";

export interface UseVisibilityOptions {
  /** Root margin for IntersectionObserver. Default: "200px" (preload 200px before visible) */
  rootMargin?: string;
  /** Threshold for IntersectionObserver. Default: 0 */
  threshold?: number;
}

/**
 * useVisibility
 *
 * @param options - IntersectionObserver options
 * @returns [ref, isVisible] — attach ref to the element to observe
 *
 * @example
 * const [cardRef, isVisible] = useVisibility();
 * // Pass isVisible to child panels as `enabled={isVisible}`
 * return <div ref={cardRef}><OddsHistoryPanel enabled={isVisible} /></div>;
 */
export function useVisibility(
  options: UseVisibilityOptions = {}
): [React.RefObject<HTMLDivElement | null>, boolean] {
  const { rootMargin = "200px", threshold = 0 } = options;
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const entry = entries[0];
      if (entry?.isIntersecting) {
        setIsVisible(true);
        // Once visible, disconnect — no need to keep observing
        observerRef.current?.disconnect();
        observerRef.current = null;
      }
    },
    []
  );

  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (isVisible) return; // Already visible, no need to observe
    if (!ref.current) return;

    observerRef.current = new IntersectionObserver(handleIntersect, {
      rootMargin,
      threshold,
    });
    observerRef.current.observe(ref.current);

    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [handleIntersect, rootMargin, threshold, isVisible]);

  return [ref, isVisible];
}
