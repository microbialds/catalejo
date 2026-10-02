// Set bar actions (requirements §5.1, §5.2, §5.5; collection board): the
// "complete genomes only" toggle, "Share link", which copies the current URL
// and states the result in a short status, and "Save set", which downloads
// the exchange file of contract §7.5 with the identifiers the engine
// resolves for the current set.
import { useEffect, useRef, useState } from 'react';
import { useManifest } from '../data/manifest';
import { useSetEngine } from '../data/setEngineContext';
import { downloadText } from '../download';
import { genomeSetDocument, genomeSetText } from '../set/exchange';
import { useGenomeSet } from '../set/store';
import { strings } from '../strings';
import { Button } from './Button';
import { Checkbox } from './Checkbox';

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
    <div className="flex items-center gap-2">
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
