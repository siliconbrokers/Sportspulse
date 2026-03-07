/**
 * Radar SportPulse — Empty State
 * Spec: radar-04-ui-ux-spec.md §18
 */

export function RadarEmptyState() {
  return (
    <div style={{
      padding: '24px 20px',
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 12,
      textAlign: 'center',
    }}>
      <div style={{
        fontSize: 14,
        fontWeight: 600,
        color: 'rgba(255,255,255,0.5)',
        marginBottom: 6,
      }}>
        No hay señales claras para destacar en esta jornada
      </div>
      <div style={{
        fontSize: 12,
        color: 'rgba(255,255,255,0.3)',
      }}>
        Los partidos de esta fecha no dejaron lecturas suficientemente fuertes para el Radar.
      </div>
    </div>
  );
}
