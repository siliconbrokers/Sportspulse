import type { WarningDTO } from '../types/snapshot.js';
import { WARNING_LABELS } from '../utils/labels.js';

interface WarningBannerProps {
  warnings: WarningDTO[];
}

export function WarningBanner({ warnings }: WarningBannerProps) {
  const TEAM_LEVEL_CODES = new Set(['MISSING_SIGNAL', 'NO_UPCOMING_MATCH', 'INSUFFICIENT_HISTORY']);
  const visible = warnings.filter(
    (w) => (w.severity === 'WARN' || w.severity === 'ERROR') && !TEAM_LEVEL_CODES.has(w.code),
  );
  if (visible.length === 0) return null;

  return (
    <div data-testid="warning-banner" style={{ padding: '0 16px' }}>
      {visible.map((w, i) => (
        <div
          key={`${w.code}-${i}`}
          style={{
            padding: '6px 12px',
            marginBottom: 4,
            borderRadius: 4,
            fontSize: 13,
            backgroundColor: w.severity === 'ERROR' ? 'var(--sp-status-error-soft)' : 'var(--sp-status-warning-soft)',
            color: w.severity === 'ERROR' ? 'var(--sp-status-error)' : 'var(--sp-status-warning)',
          }}
        >
          {WARNING_LABELS[w.code] ?? w.message ?? w.code}
        </div>
      ))}
    </div>
  );
}
