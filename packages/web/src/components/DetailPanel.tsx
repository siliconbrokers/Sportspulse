import { useEffect } from 'react';
import type { TeamDetailDTO } from '../types/team-detail.js';

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
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: 360,
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
        <h3 style={{ fontSize: 14, opacity: 0.7, margin: '0 0 8px' }}>Scores</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <ScoreBox label="Attention" value={detail.score.attentionScore} />
          <ScoreBox label="Display" value={detail.score.displayScore} />
          <ScoreBox label="Raw" value={detail.score.rawScore} />
          <ScoreBox label="Weight" value={detail.score.layoutWeight} />
        </div>
      </section>

      {detail.nextMatch && (
        <section data-testid="next-match" style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 14, opacity: 0.7, margin: '0 0 8px' }}>Next Match</h3>
          <p style={{ margin: 0, fontSize: 14 }}>
            vs {detail.nextMatch.opponentName ?? 'TBD'}{' '}
            {detail.nextMatch.venue && `(${detail.nextMatch.venue})`}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12, opacity: 0.6 }}>
            {detail.nextMatch.kickoffUtc}
          </p>
        </section>
      )}

      <section data-testid="explain-section" style={{ marginTop: 16 }}>
        <h3 style={{ fontSize: 14, opacity: 0.7, margin: '0 0 8px' }}>Contributions</h3>
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
              <span>{c.signalKey}</span>
              <span style={{ fontWeight: 600 }}>{c.weightedContribution.toFixed(2)}</span>
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
