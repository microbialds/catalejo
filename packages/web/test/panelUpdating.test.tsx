// @vitest-environment jsdom
// Held views (requirements §6.1, §9; components/panelUpdating.ts): a panel
// holding an older set's view shows "Updating" and is aria-busy only once
// the hold has lasted UPDATING_DELAY_MS, so a fast update never flickers;
// both clear at once when the view catches up. The hold reaches the panel
// through PanelHeldContext without redrawing the panel's body, or through
// Panel's `updating` prop.
import { act, cleanup, render, screen } from '@testing-library/react';
import { memo } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Panel } from '../src/components/Panel';
import { PanelHeldContext, UPDATING_DELAY_MS } from '../src/components/panelUpdating';
import { strings } from '../src/strings';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const bodyRenders = vi.fn();

function Body() {
  bodyRenders();
  return <p>{strings.panelLoading}</p>;
}

// A memoized panel, as the collection page's are: its props never change here.
const Memoized = memo(function Memoized() {
  return (
    <Panel title={strings.panelSpecies} name={strings.panelSpecies}>
      <Body />
    </Panel>
  );
});

function Page({ held }: { held: boolean }) {
  return (
    <PanelHeldContext value={held}>
      <Memoized />
    </PanelHeldContext>
  );
}

const region = () => screen.getByRole('region', { name: strings.panelSpecies });
const note = () => screen.queryByText(strings.panelUpdating);

describe('panel updating note', () => {
  it('shows after the delay and clears at once when the view catches up', () => {
    bodyRenders.mockClear();
    const { rerender } = render(<Page held={false} />);
    expect(note()).toBeNull();
    rerender(<Page held />);
    act(() => {
      vi.advanceTimersByTime(UPDATING_DELAY_MS - 1);
    });
    expect(note()).toBeNull();
    expect(region().getAttribute('aria-busy')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(note()).not.toBeNull();
    expect(region().getAttribute('aria-busy')).toBe('true');
    rerender(<Page held={false} />);
    expect(note()).toBeNull();
    expect(region().getAttribute('aria-busy')).toBeNull();
    // The body drew once: the hold reached the panel's frame only.
    expect(bodyRenders).toHaveBeenCalledTimes(1);
  });

  it('never shows on an update faster than the delay', () => {
    const { rerender } = render(<Page held={false} />);
    for (let round = 0; round < 3; round += 1) {
      rerender(<Page held />);
      act(() => {
        vi.advanceTimersByTime(UPDATING_DELAY_MS / 2);
      });
      expect(note()).toBeNull();
      rerender(<Page held={false} />);
      act(() => {
        vi.advanceTimersByTime(UPDATING_DELAY_MS * 2);
      });
      expect(note()).toBeNull();
      expect(region().getAttribute('aria-busy')).toBeNull();
    }
  });

  it('follows the updating prop of a panel with its own pending results', () => {
    const view = (updating: boolean) => (
      <Panel title={strings.panelGenomes} name={strings.panelGenomes} updating={updating}>
        <Body />
      </Panel>
    );
    const { rerender } = render(view(true));
    act(() => {
      vi.advanceTimersByTime(UPDATING_DELAY_MS);
    });
    expect(screen.getByText(strings.panelUpdating)).toBeTruthy();
    expect(
      screen.getByRole('region', { name: strings.panelGenomes }).getAttribute('aria-busy'),
    ).toBe('true');
    rerender(view(false));
    expect(note()).toBeNull();
  });
});
