// Fit of the set bar's filter chips on one line (requirements §5.1). The bar
// keeps its 56 px height at every width, so the chips that do not fit on the
// line give way to a "+N more" control that opens the full list. Chips keep
// the store's order: the row shows the first chips that fit, and the control
// counts every other one, so that no chip is ever hidden without the count.
// Widths are in CSS pixels, as measured in the browser.

/** Subpixel slack, so that a row measured at its exact width still fits. */
const SLACK = 0.5;

/**
 * How many chips, in store order, the row shows within `available`: all of
 * them when they fit with `gap` between neighbours, otherwise as many as fit
 * before the "+N more" control of width `moreWidth` (possibly none).
 */
export function visibleChipCount(
  widths: readonly number[],
  available: number,
  gap: number,
  moreWidth: number,
): number {
  const all = widths.reduce((total, width, index) => total + width + (index > 0 ? gap : 0), 0);
  if (all <= available + SLACK) return widths.length;
  let used = moreWidth;
  let count = 0;
  for (const width of widths) {
    const next = used + width + gap;
    if (next > available + SLACK) break;
    used = next;
    count += 1;
  }
  return count;
}
