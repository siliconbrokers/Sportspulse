import type { WarningDTO } from '../types/snapshot.js';

const WARNING_TEXT: Record<string, string> = {
  STALE_DATA: 'Data may be outdated',
  PARTIAL_DATA: 'Some data incomplete',
  LAYOUT_DEGRADED: 'Layout in fallback mode',
  PROVIDER_ERROR: 'Data source error',
};

interface WarningBannerProps {
  warnings: WarningDTO[];
}

export function WarningBanner({ warnings }: WarningBannerProps) {
  const visible = warnings.filter((w) => w.severity === 'WARN' || w.severity === 'ERROR');
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
            backgroundColor: w.severity === 'ERROR' ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)',
            color: w.severity === 'ERROR' ? '#fca5a5' : '#fde68a',
          }}
        >
          {WARNING_TEXT[w.code] ?? w.message ?? w.code}
        </div>
      ))}
    </div>
  );
}
