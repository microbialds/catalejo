// @vitest-environment jsdom
// The shared popover dismissal (requirements §9, keyboard reachable controls;
// §6.1, column selection): Escape closes and returns the focus to the
// trigger, a pointer down outside closes and leaves the focus alone, a
// pointer down inside keeps the popover open, and an Escape another handler
// consumed is ignored.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDismiss } from '../src/components/useDismiss';

function Popover({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useDismiss(open, {
    root,
    trigger,
    onClose: () => {
      onClose?.();
      setOpen(false);
    },
  });
  return (
    <div>
      <div ref={root}>
        <button
          ref={trigger}
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
          }}
        >
          trigger
        </button>
        {open && (
          <fieldset aria-label="popover">
            <input type="checkbox" aria-label="inside" />
            <input
              type="text"
              aria-label="consumer"
              onKeyDown={(event) => {
                if (event.key === 'Escape') event.preventDefault();
              }}
            />
          </fieldset>
        )}
      </div>
      <button type="button">outside</button>
    </div>
  );
}

const trigger = () => screen.getByRole('button', { name: 'trigger' });
const popover = () => screen.queryByRole('group', { name: 'popover' });

function open() {
  fireEvent.click(trigger());
  expect(popover()).not.toBeNull();
}

afterEach(cleanup);

describe('useDismiss', () => {
  it('closes on Escape from inside the popover and returns the focus to the trigger', () => {
    render(<Popover />);
    open();
    const inside = screen.getByRole('checkbox', { name: 'inside' });
    inside.focus();
    expect(document.activeElement).toBe(inside);
    fireEvent.keyDown(inside, { key: 'Escape' });
    expect(popover()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger());
  });

  it('closes on Escape when the focus is on the page body', () => {
    render(<Popover />);
    open();
    act(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('closes on a pointer down outside and leaves the focus where it is', () => {
    render(<Popover />);
    open();
    const outside = screen.getByRole('button', { name: 'outside' });
    outside.focus();
    fireEvent.pointerDown(outside);
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(outside);
  });

  it('stays open on a pointer down inside the popover or on the trigger', () => {
    render(<Popover />);
    open();
    fireEvent.pointerDown(screen.getByRole('checkbox', { name: 'inside' }));
    expect(popover()).not.toBeNull();
    fireEvent.pointerDown(trigger());
    expect(popover()).not.toBeNull();
  });

  it('ignores an Escape another handler consumed, and other keys', () => {
    const onClose = vi.fn();
    render(<Popover onClose={onClose} />);
    open();
    const consumer = screen.getByRole('textbox', { name: 'consumer' });
    fireEvent.keyDown(consumer, { key: 'Escape' });
    fireEvent.keyDown(consumer, { key: 'Enter' });
    expect(popover()).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('listens only while open', () => {
    const onClose = vi.fn();
    render(<Popover onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.pointerDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
    open();
    fireEvent.click(trigger());
    expect(popover()).toBeNull();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
