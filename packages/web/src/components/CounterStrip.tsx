// Counter strip (requirements §6.1, §7; collection board, counters). A ruled
// strip with a heavy ink top rule and a hairline bottom rule; each counter is
// a 24 px monospace numeral over an 11 px caption, separated by hairlines.
// Below the compact breakpoint the counters wrap two to a row so the page
// never scrolls sideways (§5.10). A link inside the strip is in the quiet
// tier (§5.4).
import { formatCount } from '../format';
import { strings } from '../strings';

export interface Counter {
  key: string;
  label: string;
  /** The label for a count of one, where it differs. */
  labelOne?: string;
  /** Undefined while pending. */
  value: number | undefined;
}

export function CounterStrip({ label, counters }: { label: string; counters: Counter[] }) {
  return (
    <dl
      aria-label={label}
      className="grid grid-cols-5 border-t border-b border-t-ink border-b-border-strong max-compact:grid-cols-2 [&_a]:link-quiet"
    >
      {counters.map((counter) => (
        <div
          key={counter.key}
          className="mr-3.5 flex min-w-0 flex-col-reverse gap-px border-r border-border-strong py-2.5 pr-3.5"
        >
          <dt className="text-small text-text-secondary">
            {counter.value === 1 && counter.labelOne !== undefined
              ? counter.labelOne
              : counter.label}
          </dt>
          <dd className="font-mono text-counter leading-tight font-bold tracking-tight">
            {counter.value === undefined ? strings.valuePending : formatCount(counter.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
