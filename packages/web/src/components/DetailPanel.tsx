import { useEffect } from 'react';
import type { TeamDetailDTO } from '../types/team-detail.js';
import { formatDateTime } from '../utils/format-date.js';
import { signalLabel, venueLabel, SCORE_LABELS } from '../utils/labels.js';

interface DetailPanelProps {
  detail: TeamDetailDTO;
  onClose: () => void;
}

export function DetailPanel({ detail, onClose }: DetailPanelProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <aside
      data-testid="detail-panel"
      className="detail-panel"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        height: '100vh',
        backgroundColor: '#1e293b',
        color: '#fff',
        padding: 20,
        overflowY: 'auto',
        boxShadow: '-4px 0 20px rgba(0,0,0,0.3)',
        animation: 'slideIn 220ms ease-out',
        zIndex: 100,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{detail.team.teamName}</h2>
        <button
          data-testid="close-detail"
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#fff',
            fontSize: 20,
            cursor: 'pointer',
          }}
        >
          ✕
        </button>
      </div>

      <section style={{ marginTop: 16 }}>
        <h3 style={{ fontSize: 14, opacity: 0.7, margin: '0 0 8px' }}>Puntuaciones</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <ScoreBox label={SCORE_LABELS.attentionScore} value={detail.score.attentionScore} />
          <ScoreBox label={SCORE_LABELS.displayScore} value={detail.score.displayScore} />
          <ScoreBox label={SCORE_LABELS.rawScore} value={detail.score.rawScore} />
          <ScoreBox label={SCORE_LABELS.layoutWeight} value={detail.score.layoutWeight} />
        </div>
      </section>

      {detail.nextMatch && (
        <section data-testid="next-match" style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 14, opacity: 0.7, margin: '0 0 8px' }}>Próximo partido</h3>
          <p style={{ margin: 0, fontSize: 14 }}>
            vs {detail.nextMatch.opponentName ?? 'Por definir'}{' '}
            {detail.nextMatch.venue && (
              <span style={{ opacity: 0.7 }}>({venueLabel(detail.nextMatch.venue)})</span>
            )}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12, opacity: 0.6 }}>
            {formatDateTime(detail.nextMatch.kickoffUtc, detail.header.timezone)}
          </p>
        </section>
      )}

      <section data-testid="explain-section" style={{ marginTop: 16 }}>
        <h3 style={{ fontSize: 14, opacity: 0.7, margin: '0 0 8px' }}>Factores de atención</h3>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {detail.explainability.topContributions.map((c) => (
            <li
              key={c.signalKey}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '4px 0',
                fontSize: 13,
                borderBottom: '1px solid rgba(255,255,255,0.1)',
              }}
            >
              <span>{signalLabel(c.signalKey)}</span>
              <span style={{ fontWeight: 600 }}>{c.contribution.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

function ScoreBox({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        backgroundColor: 'rgba(255,255,255,0.1)',
        borderRadius: 6,
        padding: '8px 12px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 11, opacity: 0.6 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{value.toFixed(1)}</div>
    </div>
  );
}
