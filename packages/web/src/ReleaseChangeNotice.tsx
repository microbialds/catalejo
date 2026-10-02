// What the application shows in place of the page when the release it loaded
// has been replaced (requirements §10, "a request for a release other than
// the current one is refused, and the application asks the reader to
// reload"): the wordmark, one statement and a reload button, as the manifest
// notice is laid out (components/ManifestNotice.tsx), never an error trace.
import { Button } from './components/Button';
import { strings } from './strings';

export function ReleaseChangeNotice({ reload }: { reload?: () => void }) {
  const onReload =
    reload ??
    (() => {
      window.location.reload();
    });
  return (
    <main className="flex min-h-screen flex-col items-start gap-3 bg-background px-page-padding-x py-page-padding-y text-base text-ink">
      <span className="font-sans text-wordmark leading-tight font-bold tracking-tight">
        {strings.wordmark}
      </span>
      <p role="alert">{strings.releaseStale}</p>
      <Button variant="primary" onClick={onReload}>
        {strings.releaseReload}
      </Button>
    </main>
  );
}
