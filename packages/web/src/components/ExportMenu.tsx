// Export menu (requirements §8; checklist C6, M3, M4). Every chart, map,
// tree and heatmap lists the presets of config/export-presets.yaml, labels
// from the strings module through each preset's label_key; every table lists
// CSV of the rows shown and of the whole set. Exports arrive in milestone 5,
// so the entries are disabled and a statement says so.
import { useId } from 'react';
import { exportPresets } from '../generated/platform';
import { strings } from '../strings';

export type ExportKind = 'figure' | 'table';

export function ExportMenu({ kind }: { kind: ExportKind }) {
  const statementId = useId();
  const entries =
    kind === 'figure'
      ? exportPresets.map((preset) => ({ key: preset.key, label: strings[preset.labelKey] }))
      : [
          { key: 'csv_shown', label: strings.exportCsvShown },
          { key: 'csv_set', label: strings.exportCsvSet },
        ];
  return (
    <div
      role="group"
      aria-label={strings.exportMenuLabel}
      aria-describedby={statementId}
      className="flex flex-col gap-1.5 border-b border-rule-light pb-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-small font-bold tracking-label text-text-label">
          {strings.exportMenuLabel}
        </span>
        {entries.map((entry) => (
          <button
            key={entry.key}
            type="button"
            disabled
            className="rounded-control border border-control-border bg-panel px-2 py-0.5 text-control text-text-faint"
          >
            {entry.label}
          </button>
        ))}
      </div>
      <p id={statementId} className="text-small text-text-secondary">
        {kind === 'figure' ? strings.exportFigureUnavailable : strings.exportTableUnavailable}
      </p>
    </div>
  );
}
