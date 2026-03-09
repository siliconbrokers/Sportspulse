/**
 * TopScorers — widget bento Top 5 goleadores
 * Tokens: bg-brand-dark, rounded-bento, brand-primary
 */
import { useState } from 'react';
import type { TopScorerEntry } from '../hooks/use-scorers.js';

// ─── Foto del jugador (circular, fallback = escudo del equipo) ────────────────
function PlayerAvatar({ crestUrl, name }: { crestUrl?: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(' ')
    .slice(-1)[0]   // apellido
    .slice(0, 2)
    .toUpperCase();

  if (!crestUrl || failed) {
    return (
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: 'rgba(0,224,255,0.1)',
          border: '1px solid rgba(0,224,255,0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 700,
          color: '#00E0FF',
          flexShrink: 0,
        }}
      >
        {initials}
      </div>
    );
  }

  return (
    <img
      src={crestUrl}
      alt={name}
      onError={() => setFailed(true)}
      style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        objectFit: 'contain',
        background: '#1A1D24',
        border: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
        padding: 3,
      }}
    />
  );
}

// ─── Burbuja de goles neon ─────────────────────────────────────────────────────
function GoalsBubble({ goals }: { goals: number }) {
  return (
    <div
      style={{
        minWidth: 36,
        height: 36,
        borderRadius: '50%',
        background: 'rgba(0,224,255,0.1)',
        border: '1px solid rgba(0,224,255,0.4)',
        boxShadow: '0 0 10px rgba(0,224,255,0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 14,
        fontWeight: 900,
        color: '#00E0FF',
        textShadow: '0 0 8px rgba(0,224,255,0.5)',
        flexShrink: 0,
        letterSpacing: '-0.02em',
      }}
    >
      {goals}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0' }}>
      <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ height: 11, width: '65%', borderRadius: 3, background: 'rgba(255,255,255,0.07)' }} />
        <div style={{ height: 10, width: '45%', borderRadius: 3, background: 'rgba(255,255,255,0.04)' }} />
      </div>
      <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
interface TopScorersProps {
  scorers: TopScorerEntry[] | null;
  loading: boolean;
}

export function TopScorers({ scorers, loading }: TopScorersProps) {
  const hasData = scorers && scorers.length > 0;

  if (!loading && !hasData) return null;

  return (
    <div
      style={{
        background: 'var(--sp-bg)',
        borderRadius: '1.5rem',
        border: '1px solid var(--sp-border)',
        overflow: 'hidden',
        transition: 'background 0.2s ease',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 20px 12px',
          borderBottom: '1px solid var(--sp-border-5)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 16 }}>⚽</span>
        <h3
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--sp-text-88)',
            margin: 0,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          Goleadores
        </h3>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: '#00E0FF',
            background: 'rgba(0,224,255,0.08)',
            border: '1px solid rgba(0,224,255,0.2)',
            borderRadius: 20,
            padding: '2px 7px',
            letterSpacing: '0.04em',
          }}
        >
          TOP 5
        </span>
      </div>

      {/* Lista */}
      <div style={{ padding: '4px 20px 16px' }}>
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
        ) : (
          (scorers ?? []).map((scorer, i) => (
            <div
              key={scorer.playerName + scorer.teamName}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 0',
                borderBottom: i < (scorers?.length ?? 0) - 1
                  ? '1px solid rgba(255,255,255,0.04)'
                  : 'none',
              }}
            >
              {/* Rank */}
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: i === 0 ? '#fbbf24' : 'rgba(255,255,255,0.25)',
                  minWidth: 14,
                  textAlign: 'center',
                  flexShrink: 0,
                }}
              >
                {scorer.rank}
              </span>

              {/* Avatar = equipo crest (no hay foto de jugador en free tier) */}
              <PlayerAvatar crestUrl={scorer.teamCrestUrl} name={scorer.playerName} />

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--sp-text-88)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    lineHeight: 1.3,
                  }}
                >
                  {scorer.playerName}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--sp-text-35)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    marginTop: 2,
                  }}
                >
                  {scorer.teamName}
                  {scorer.assists > 0 && (
                    <span style={{ marginLeft: 6, color: 'var(--sp-text-20)' }}>
                      · {scorer.assists} ast
                    </span>
                  )}
                </div>
              </div>

              {/* Goles */}
              <GoalsBubble goals={scorer.goals} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
