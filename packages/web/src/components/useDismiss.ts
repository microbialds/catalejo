// Dismissal of popovers (requirements §9, keyboard reachable controls; §6.1,
// column selection; §5.2, the add filter menu). While a popover is open,
// Escape closes it wherever the focus is and returns the focus to the control
// that opened it, and a pointer down outside its root closes it and leaves
// the focus where the pointer put it. The root must contain the trigger, so a
// press on the trigger itself is left to the trigger's own toggle. An Escape
// that another handler already consumed (event.defaultPrevented, for example
// a list inside the popover that clears its own state first) is ignored.
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

export interface DismissOptions {
  /** The element that holds the trigger and the popover. */
  root: RefObject<HTMLElement | null>;
  /** The control that opened the popover; it takes the focus back on Escape. */
  trigger: RefObject<HTMLElement | null>;
  /** Closes the popover. */
  onClose: () => void;
}

export function useDismiss(open: boolean, { root, trigger, onClose }: DismissOptions): void {
  // The latest close function, so an inline callback does not re-register the listeners.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const element = root.current;
      if (element !== null && !element.contains(event.target as Node)) close.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      close.current();
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, root, trigger]);
}
