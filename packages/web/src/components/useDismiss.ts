// Dismissal of popovers and drawers (requirements §9, keyboard reachable
// controls; §6.1, column selection; §5.2, the add filter menu; §5.10, the
// facet drawer and the compact navigation menu). While a popover is open,
// Escape closes it wherever the focus is and returns the focus to the
// control that opened it, and a pointer down outside its root closes it and
// leaves the focus where the pointer put it.
// The press that dismisses does nothing else: the click that ends it is
// swallowed (a capture listener on the window, before React's), so that
// closing the drawer over a heatmap cell, a bar or a facet never also
// applies that element as a filter. The swallow lasts for that one press
// only; it is dropped right after the pointer up or cancel when no click
// follows (a drag, a release elsewhere), and at the latest when the next
// press begins. One exception: a press on another disclosure control (an
// element with aria-expanded, such as "Menu", "Filters", "Columns", "+ add
// filter" or a panel's "expand") still toggles that one, so that moving
// between popovers takes one click, and closes this popover when the press
// ends (on its click, or right after the pointer up or cancel when no click
// follows) instead of on the pointer down. The deferral keeps the layout
// still for the length of the press: the compact Menu lies in the page flow,
// and closing it on the pointer down would move "Filters" or "+ add filter"
// from under the pointer before the click.
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

/** Whether a press on this target toggles another popover (aria-expanded). */
function isDisclosure(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[aria-expanded]') !== null;
}

/**
 * Closes a popover when the current press ends: on its click, or right after
 * the pointer up or cancel when no click follows, and at the latest when the
 * next press begins. Each popover arms its own, so that several close on the
 * same press.
 */
function closeAfterPress(onClose: () => void): void {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    window.removeEventListener('click', finish, true);
    window.removeEventListener('pointerup', later, true);
    window.removeEventListener('pointercancel', later, true);
    window.removeEventListener('pointerdown', finish, true);
    onClose();
  };
  // The click of a press is dispatched in the same task as its pointer up,
  // so a timer set on pointer up runs after it.
  const later = () => {
    window.setTimeout(finish, 0);
  };
  window.addEventListener('click', finish, true);
  window.addEventListener('pointerup', later, true);
  window.addEventListener('pointercancel', later, true);
  // Added while the pressing pointer down is past the window's capture
  // phase, so it answers only the next press.
  window.addEventListener('pointerdown', finish, true);
}

/** Drops the armed swallow, when one is armed. */
let disarmSwallow: (() => void) | undefined;

/**
 * Swallows the click that ends the current press, if one follows. Several
 * popovers closed by the same press arm it once.
 */
function swallowNextClick(pressed: Node): void {
  if (disarmSwallow !== undefined) return;
  const swallow = (event: MouseEvent) => {
    // The click of a press targets the pressed element or an ancestor of it
    // (where the pointer up landed elsewhere); any other click is not it.
    if (!(event.target instanceof Node) || !event.target.contains(pressed)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    disarm();
  };
  // The click of a press is dispatched in the same task as its pointer up,
  // so a timer set on pointer up runs after it.
  const later = () => {
    window.setTimeout(disarm, 0);
  };
  const disarm = () => {
    window.removeEventListener('click', swallow, true);
    window.removeEventListener('pointerup', later, true);
    window.removeEventListener('pointercancel', later, true);
    window.removeEventListener('pointerdown', disarm, true);
    if (disarmSwallow === disarm) disarmSwallow = undefined;
  };
  window.addEventListener('click', swallow, true);
  window.addEventListener('pointerup', later, true);
  window.addEventListener('pointercancel', later, true);
  // Added while the dismissing pointer down is past the window's capture
  // phase, so it answers only the next press.
  window.addEventListener('pointerdown', disarm, true);
  disarmSwallow = disarm;
}

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
      if (root.current === null || contains(event.target as Node)) return;
      if (isDisclosure(event.target)) {
        closeAfterPress(() => {
          close.current();
        });
        return;
      }
      close.current();
      swallowNextClick(event.target as Node);
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
