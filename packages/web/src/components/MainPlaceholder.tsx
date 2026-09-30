// Main area placeholder (milestone 0). Names the page for the current route
// (requirements §5.3) and states that it arrives in a later milestone.
import { pageTitle } from '../navigation';
import { strings } from '../strings';

export function MainPlaceholder({ pathname }: { pathname: string }) {
  const title = pageTitle(pathname);
  return (
    <main className="flex min-w-0 flex-col gap-2 px-page-padding-x py-page-padding-y">
      {title !== undefined && (
        <h1 className="font-serif text-panel-title font-semibold">{title}</h1>
      )}
      <p className="text-text-secondary">{strings.placeholderStatement}</p>
    </main>
  );
}
