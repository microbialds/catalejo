// What the application shows instead of the shell when the manifest cannot be
// used (data contract §2, §6.4): a release whose schema version is outside
// the supported range shows the mismatch, with the release's version and the
// supported range, and nothing else; a missing or unreadable manifest shows a
// plain statement.
import { strings } from '../strings';

export function ManifestNotice({ statement }: { statement: string }) {
  return (
    <main className="flex min-h-screen flex-col gap-3 bg-background px-page-padding-x py-page-padding-y text-base text-ink">
      <span className="font-serif text-wordmark leading-tight font-semibold tracking-tight">
        {strings.wordmark}
      </span>
      <p role="alert">{statement}</p>
    </main>
  );
}
