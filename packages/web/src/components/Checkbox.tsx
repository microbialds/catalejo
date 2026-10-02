// Checkbox (requirements §5.4, "All colors come from config/palette.yaml";
// §7, each component once with its variants, square corners, hairline
// borders; §9, keyboard reachable controls and visible focus; checklist G3).
// The one checkbox of the application: a real <input type="checkbox">, so
// that labels, keyboard toggling, the checkbox role and the indeterminate
// state stay native, drawn with `appearance: none` so that the browser paints
// none of its own grays. Every painted color is a chrome token:
//   unchecked      1 px control_border border on the panel color
//   checked        ink fill and border, an on_ink check mark
//   indeterminate  ink fill and border, an on_ink bar (the select-all box
//                  when some rows of the page are selected)
//   disabled       text_label border and mark on the panel color (text_label
//                  keeps AA contrast, §9; text_faint is decorative only)
// with radius_control corners and the hairline ink outline of :focus-visible
// (index.css) on keyboard focus. The mark is an inline SVG sibling shown by
// the input's state (Tailwind peer variants), never a background image.
// A raw type="checkbox" anywhere else fails test/design.test.ts.
import type { ComponentPropsWithRef } from 'react';

export interface CheckboxProps extends Omit<ComponentPropsWithRef<'input'>, 'type'> {
  /** The mixed state; drawn as a bar and exposed as aria-checked="mixed". */
  indeterminate?: boolean;
}

const box = [
  'peer col-start-1 row-start-1 m-0 size-3.25 cursor-pointer appearance-none',
  'rounded-control border border-control-border bg-panel',
  'checked:border-ink checked:bg-ink indeterminate:border-ink indeterminate:bg-ink',
  'disabled:cursor-default disabled:border-text-label',
  'disabled:checked:border-text-label disabled:checked:bg-panel',
  'disabled:indeterminate:border-text-label disabled:indeterminate:bg-panel',
].join(' ');

const mark =
  'pointer-events-none col-start-1 row-start-1 hidden size-3.25 stroke-on-ink peer-disabled:stroke-text-label';

export function Checkbox({ indeterminate = false, className, ref, ...rest }: CheckboxProps) {
  const wrapper = `inline-grid size-3.25 shrink-0 align-middle${className === undefined ? '' : ` ${className}`}`;
  return (
    <span className={wrapper}>
      <input
        {...rest}
        type="checkbox"
        className={box}
        ref={(element) => {
          if (element !== null) element.indeterminate = indeterminate;
          if (typeof ref === 'function') return ref(element);
          if (ref !== null && ref !== undefined) ref.current = element;
          return undefined;
        }}
      />
      {indeterminate ? (
        <svg
          aria-hidden="true"
          viewBox="0 0 13 13"
          fill="none"
          strokeWidth={1.5}
          className={`${mark} peer-indeterminate:block`}
        >
          <path d="M3.5 6.5h6" />
        </svg>
      ) : (
        <svg
          aria-hidden="true"
          viewBox="0 0 13 13"
          fill="none"
          strokeWidth={1.5}
          className={`${mark} peer-checked:block`}
        >
          <path d="M3 6.75 5.25 9 10 4" />
        </svg>
      )}
    </span>
  );
}
