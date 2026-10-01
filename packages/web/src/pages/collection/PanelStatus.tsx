// The body of a collection panel before its counts arrive: "Loading", or the
// statement that the counts could not be loaded (requirements §6.1).
import { strings } from '../../strings';

export function PanelStatus({ failed }: { failed: boolean }) {
  return (
    <p className="text-control text-text-secondary" {...(failed ? { role: 'alert' } : {})}>
      {failed ? strings.panelLoadFailed : strings.panelLoading}
    </p>
  );
}
