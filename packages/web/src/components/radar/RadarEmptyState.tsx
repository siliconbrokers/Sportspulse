/**
 * Radar SportPulse — Empty State. Premium 2026.
 */

export function RadarEmptyState() {
  return (
    <div style={{
      padding: '32px 24px',
      background: 'var(--sp-surface-card, rgba(255,255,255,0.03))',
      border: '1px solid var(--sp-border-8, rgba(255,255,255,0.08))',
      borderRadius: 16,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 28, marginBottom: 12 }}>📡</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sp-text-50, rgba(255,255,255,0.5))', marginBottom: 6 }}>
        Sin señales para esta jornada
      </div>
      <div style={{ fontSize: 12, color: 'var(--sp-text-30, rgba(255,255,255,0.3))' }}>
        Los partidos de esta fecha no generaron lecturas suficientemente fuertes para el Radar.
      </div>
    </div>
  );
}
