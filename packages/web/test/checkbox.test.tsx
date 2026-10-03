// @vitest-environment jsdom
// The one checkbox (requirements §5.4, §7, §9; checklist G3): a native
// checkbox input drawn with appearance none from chrome tokens only, with
// the indeterminate state set on the element, the check or bar mark shown by
// the input's state, and keyboard and label behavior left to the browser.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Checkbox } from '../src/components/Checkbox';

afterEach(cleanup);

function classes(element: Element | null): string[] {
  return (element?.getAttribute('class') ?? '').split(/\s+/);
}

describe('Checkbox', () => {
  it('is a native checkbox drawn from the chrome tokens', () => {
    render(<Checkbox aria-label="box" />);
    const box = screen.getByRole('checkbox', { name: 'box' });
    expect(box.getAttribute('type')).toBe('checkbox');
    expect(classes(box)).toEqual(
      expect.arrayContaining([
        'appearance-none',
        'rounded-control',
        'border',
        'border-control-border',
        'bg-panel',
        'checked:bg-ink',
        'checked:border-ink',
        'disabled:border-text-label',
        'disabled:checked:bg-panel',
      ]),
    );
    // No accent color and no outline suppression: the focus ring is the global one.
    expect(classes(box).some((name) => name.startsWith('accent-'))).toBe(false);
    expect(classes(box)).not.toContain('outline-none');
    const mark = box.nextElementSibling;
    expect(mark?.tagName.toLowerCase()).toBe('svg');
    expect(classes(mark)).toEqual(
      expect.arrayContaining(['hidden', 'peer-checked:block', 'stroke-on-ink']),
    );
    expect(classes(mark)).toContain('peer-disabled:stroke-text-label');
  });

  it('toggles from its label and reports the change', () => {
    const onChange = vi.fn();
    render(
      <label>
        <Checkbox
          onChange={(event) => {
            onChange(event.target.checked);
          }}
        />
        name
      </label>,
    );
    fireEvent.click(screen.getByText('name'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('sets the indeterminate state and draws the bar for it', () => {
    const ref = createRef<HTMLInputElement>();
    const { rerender } = render(<Checkbox aria-label="all" indeterminate ref={ref} />);
    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: 'all' });
    expect(box.indeterminate).toBe(true);
    expect(ref.current).toBe(box);
    expect(classes(box.nextElementSibling)).toContain('peer-indeterminate:block');
    rerender(<Checkbox aria-label="all" checked readOnly ref={ref} />);
    expect(box.indeterminate).toBe(false);
    expect(box.checked).toBe(true);
    expect(classes(box.nextElementSibling)).toContain('peer-checked:block');
  });

  it('can be disabled', () => {
    render(<Checkbox aria-label="fixed" disabled checked readOnly />);
    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: 'fixed' });
    expect(box.disabled).toBe(true);
  });
});
