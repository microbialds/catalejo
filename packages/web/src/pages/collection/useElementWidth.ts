// The content width of an element, for charts drawn in pixels (the QC
// scatter). Follows the element with a ResizeObserver; where none exists
// (jsdom), the fallback width is used.
import { useCallback, useState } from 'react';

export function useElementWidth(fallback: number): [(element: Element | null) => void, number] {
  const [width, setWidth] = useState(fallback);
  const ref = useCallback((element: Element | null) => {
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next !== undefined && next > 0) setWidth(Math.round(next));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return [ref, width];
}
