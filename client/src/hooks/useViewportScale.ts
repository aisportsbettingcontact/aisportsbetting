/**
 * useViewportScale — Production-grade dynamic viewport scaling hook
 *
 * Returns the current viewport dimensions, scale factor, and device type.
 * Scale is derived from: scale = clamp(1, viewportWidth / 393, 3.85)
 *   - Base reference: 393px (iPhone 16/15/14 Pro)
 *   - Min scale: 1 (no shrinking below mobile baseline)
 *   - Max scale: 3.85 (4K / ultrawide cap)
 *
 * Device classification:
 *   mobile  < 768px
 *   tablet  768px – 1024px
 *   desktop > 1024px
 *
 * Resize events are throttled to 100ms to prevent re-render storms.
 * Uses requestAnimationFrame for smooth updates without layout thrashing.
 */

import { useState, useEffect, useRef, useCallback } from "react";

const VP_BASE = 393;
const SCALE_MIN = 1;
const SCALE_MAX = 3.85;
const THROTTLE_MS = 100;

export type DeviceType = "mobile" | "tablet" | "desktop";

export interface ViewportScale {
  /** Current viewport width in CSS pixels */
  width: number;
  /** Current viewport height in CSS pixels */
  height: number;
  /**
   * Scale factor: clamp(1, width / 393, 3.85)
   * At 393px → 1.0, at 1440px → ~3.66 (capped at 3.85)
   */
  scale: number;
  /** Device classification based on viewport width */
  deviceType: DeviceType;
}

function classifyDevice(width: number): DeviceType {
  if (width < 768) return "mobile";
  if (width <= 1024) return "tablet";
  return "desktop";
}

function computeScale(width: number): number {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, width / VP_BASE));
}

function getSnapshot(): ViewportScale {
  const width = window.innerWidth;
  const height = window.innerHeight;
  return {
    width,
    height,
    scale: computeScale(width),
    deviceType: classifyDevice(width),
  };
}

/**
 * useViewportScale
 *
 * Subscribes to window resize events (throttled at 100ms via rAF) and
 * returns the current viewport scale state. Safe to call in multiple
 * components — each call creates its own listener but the throttle
 * ensures minimal work per frame.
 *
 * @example
 * const { width, height, scale, deviceType } = useViewportScale();
 * // deviceType: "mobile" | "tablet" | "desktop"
 * // scale: 1.0 at 393px, ~2.0 at 786px, 3.85 max
 */
export function useViewportScale(): ViewportScale {
  const [state, setState] = useState<ViewportScale>(() =>
    typeof window !== "undefined" ? getSnapshot() : { width: 393, height: 844, scale: 1, deviceType: "mobile" }
  );

  // Throttle via rAF — prevents layout thrashing on rapid resize
  const rafRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);

  const handleResize = useCallback(() => {
    const now = performance.now();
    // Throttle: skip if last update was < THROTTLE_MS ago
    if (now - lastUpdateRef.current < THROTTLE_MS) {
      // Schedule a deferred update to catch the final resize position
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        lastUpdateRef.current = performance.now();
        setState(getSnapshot());
        rafRef.current = null;
      });
      return;
    }
    lastUpdateRef.current = now;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setState(getSnapshot());
      rafRef.current = null;
    });
  }, []);

  useEffect(() => {
    // Initial snapshot (handles SSR hydration)
    setState(getSnapshot());

    window.addEventListener("resize", handleResize, { passive: true });
    return () => {
      window.removeEventListener("resize", handleResize);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [handleResize]);

  return state;
}

/**
 * Utility: compute a fluid px value from a base mobile size using the
 * current scale, clamped between min and max.
 *
 * @example
 * const fontSize = fluidPx(13, scale, 9, 20); // "13px" at 393px, scales up
 */
export function fluidPx(
  basePx: number,
  scale: number,
  minPx?: number,
  maxPx?: number
): number {
  const raw = basePx * scale;
  const lo = minPx ?? basePx;
  const hi = maxPx ?? basePx * SCALE_MAX;
  return Math.round(Math.min(hi, Math.max(lo, raw)) * 10) / 10;
}

/**
 * Utility: compute a fluid px value as a CSS string.
 *
 * @example
 * style={{ fontSize: fluidPxStr(13, scale, 9, 20) }}
 */
export function fluidPxStr(
  basePx: number,
  scale: number,
  minPx?: number,
  maxPx?: number
): string {
  return `${fluidPx(basePx, scale, minPx, maxPx)}px`;
}
