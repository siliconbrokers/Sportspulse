/**
 * Radar SportPulse — Unavailable State. Premium 2026.
 */

export function RadarUnavailableState() {
  return (
    <div style={{
      padding: '32px 24px',
      background: 'var(--sp-surface-card, rgba(255,255,255,0.03))',
      border: '1px solid var(--sp-border-8, rgba(255,255,255,0.08))',
      borderRadius: 16,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 28, marginBottom: 12 }}>🔌</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sp-text-40, rgba(255,255,255,0.4))', marginBottom: 6 }}>
        Radar no disponible
      </div>
      <div style={{ fontSize: 12, color: 'var(--sp-text-25, rgba(255,255,255,0.25))' }}>
        No se pudieron generar análisis para esta jornada. Intentalo de nuevo más tarde.
      </div>
    </div>
  );
}
