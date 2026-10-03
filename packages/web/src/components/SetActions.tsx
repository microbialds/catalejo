// Set bar actions (requirements §5.1, §5.2, §5.5; collection board): the
// "complete genomes only" toggle, "Share link", which copies the current URL
// and states the result in a short status, and "Save set", which downloads
// the exchange file of contract §7.5 with the identifiers the engine
// resolves for the current set. At narrow widths SetMenu groups "+ add
// filter", the toggle, "Share link" and "Save set" behind one "Set" text
// control (§5.1), so that the bar keeps its height; its popover is dismissed
// like the others (components/useDismiss.ts; Escape returns the focus to
// "Set") and closes when the path changes. The add filter menu opens over it
// and closes first on Escape.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useManifest } from '../data/manifest';
import { useSetEngine } from '../data/setEngineContext';
import { downloadText } from '../download';
import { genomeSetDocument, genomeSetText } from '../set/exchange';
import { useRouter } from '../router';
import { useGenomeSet } from '../set/store';
import { strings } from '../strings';
import { AddFilterMenu } from './AddFilterMenu';
import { Button } from './Button';
import { Checkbox } from './Checkbox';
import { useDismiss } from './useDismiss';

const STATUS_MS = 3000;

export function CompleteToggle() {
  const { completeOnly, setCompleteOnly } = useGenomeSet();
  return (
    <label className="flex items-center gap-1.5 text-control whitespace-nowrap text-ink">
      <Checkbox
        checked={completeOnly}
        onChange={(event) => {
          setCompleteOnly(event.target.checked);
        }}
      />
      {strings.completeOnly}
    </label>
  );
}

export function SetActions() {
  const manifest = useManifest();
  const getEngine = useSetEngine();
  const { filters } = useGenomeSet();
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );

  const announce = (text: string) => {
    setStatus(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setStatus('');
    }, STATUS_MS);
  };

  const share = () => {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (clipboard === undefined) {
      announce(strings.linkCopyFailed);
      return;
    }
    clipboard.writeText(window.location.href).then(
      () => {
        announce(strings.linkCopied);
      },
      () => {
        announce(strings.linkCopyFailed);
      },
    );
  };

  const save = () => {
    if (manifest === undefined || getEngine === undefined) return;
    setSaving(true);
    getEngine()
      .then((engine) => engine.setGenomeIds(filters))
      .then((ids) => {
        const document = genomeSetDocument(manifest, filters, ids, strings.savedSetName);
        downloadText(
          genomeSetText(document),
          strings.savedSetFileName(manifest.release_id),
          'application/json',
        );
      })
      .catch(() => {
        announce(strings.saveSetFailed);
      })
      .finally(() => {
        setSaving(false);
      });
  };

  return (
    <div className="flex shrink-0 items-center gap-2">
      <span
        role="status"
        aria-live="polite"
        className="text-small whitespace-nowrap text-text-secondary"
      >
        {status}
      </span>
      <Button variant="secondary" onClick={share}>
        {strings.shareLink}
      </Button>
      <Button
        variant="primary"
        onClick={save}
        disabled={manifest === undefined || saving}
        aria-busy={saving}
      >
        {strings.saveSet}
      </Button>
    </div>
  );
}

/** The bar's text toggles ("Filters", "Set"): outlined, bold, never icon-only. */
export const barToggleClass =
  'shrink-0 rounded-control border border-control-border bg-panel px-3 py-1.75 text-control font-bold text-ink max-compact:px-2';

export function SetMenu() {
  const { pathname } = useRouter();
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = useCallback(() => {
    setOpenAt(null);
  }, []);
  useDismiss(open, { root, trigger, onClose: close });
  return (
    <div ref={root} className="relative shrink-0">
      <button
        ref={trigger}
        type="button"
        className={barToggleClass}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        onClick={() => {
          setOpenAt(open ? null : pathname);
        }}
      >
        {strings.setMenuToggle}
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={strings.setMenuLabel}
          className="absolute top-full right-0 z-30 mt-2 flex w-88 max-w-[calc(100vw-2rem)] flex-col items-start gap-3 border border-border-strong bg-panel p-3"
        >
          <AddFilterMenu />
          <CompleteToggle />
          <SetActions />
        </div>
      )}
    </div>
  );
}
