// Dismissal of popovers and drawers (requirements §9, keyboard reachable
// controls; §6.1, column selection; §5.2, the add filter menu; §5.10, the
// facet drawer). While a popover is open, Escape closes it wherever the focus
// is and returns the focus to the control that opened it, and a pointer down
// outside its root closes it and leaves the focus where the pointer put it.
// The root usually contains the trigger, so a press on the trigger itself is
// left to the trigger's own toggle; a trigger that lies elsewhere (the set
// bar's "Filters" button for the facet drawer) is passed in `inside`, with
// any other element a press on which must not close it. An Escape that
// another handler already consumed (event.defaultPrevented, for example a
// list inside the popover that clears its own state first) is ignored, and
// when several are open (a menu over the open drawer) Escape closes the one
// opened last.
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

export interface DismissOptions {
  /** The element that holds the popover, and usually its trigger. */
  root: RefObject<HTMLElement | null>;
  /** The control that opened the popover; it takes the focus back on Escape. */
  trigger: RefObject<HTMLElement | null>;
  /** Other elements a pointer down on which keeps the popover open. */
  inside?: readonly RefObject<HTMLElement | null>[];
  /** Closes the popover. */
  onClose: () => void;
}

/** The open popovers, the last opened last; only it answers Escape. */
const openStack: object[] = [];

export function useDismiss(
  open: boolean,
  { root, trigger, inside, onClose }: DismissOptions,
): void {
  // The latest close function and inside list, so inline values do not
  // re-register the listeners.
  const close = useRef(onClose);
  const others = useRef(inside);
  useEffect(() => {
    close.current = onClose;
    others.current = inside;
  }, [onClose, inside]);

  useEffect(() => {
    if (!open) return;
    const token = {};
    openStack.push(token);
    const contains = (target: Node) =>
      root.current?.contains(target) === true ||
      (others.current ?? []).some((ref) => ref.current?.contains(target) === true);
    const onPointer = (event: PointerEvent) => {
      if (root.current !== null && !contains(event.target as Node)) close.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (openStack[openStack.length - 1] !== token) return;
      event.preventDefault();
      close.current();
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      openStack.splice(openStack.indexOf(token), 1);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, root, trigger]);
}
