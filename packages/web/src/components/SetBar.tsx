// Set bar placeholder (requirements §5.1, §5.2; collection board, top bar).
// 56 px high, hairline bottom rule, the count as a large serif numeral and the
// phrase. Filters, chips, search and the actions arrive in milestone 1b.
import { strings } from '../strings';

export function SetBar() {
  return (
    <header
      aria-label={strings.setBarLabel}
      className="flex h-set-bar-height shrink-0 items-center gap-panel-gap border-b border-border-strong bg-background px-page-padding-x"
    >
      <span className="font-serif text-set-count font-semibold tracking-tight">
        {strings.valuePending}
      </span>
      <span className="text-base text-text-secondary">{strings.setBarPhrase}</span>
    </header>
  );
}
