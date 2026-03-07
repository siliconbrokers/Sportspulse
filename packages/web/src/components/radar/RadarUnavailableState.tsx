/**
 * Radar SportPulse — Unavailable State
 * Spec: radar-04-ui-ux-spec.md §19
 */

export function RadarUnavailableState() {
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
        color: 'rgba(255,255,255,0.4)',
        marginBottom: 6,
      }}>
        No se pudo generar el Radar para esta jornada
      </div>
      <div style={{
        fontSize: 12,
        color: 'rgba(255,255,255,0.25)',
      }}>
        Faltan datos o hubo un problema de integración.
      </div>
    </div>
  );
}
