import { useEffect } from 'react';
import type { TeamDetailDTO } from '../types/team-detail.js';
import type { FormResult } from '../types/snapshot.js';
import { formatDateTime } from '../utils/format-date.js';
import { venueLabel, signalLabel, signalValueLabel } from '../utils/labels.js';
import { useWindowWidth } from '../hooks/use-window-width.js';

interface DetailPanelProps {
  detail: TeamDetailDTO;
  onClose: () => void;
}

const FORM_COLORS: Record<FormResult, string> = {
  W: '#22c55e',
  D: '#6b7280',
  L: '#ef4444',
};

const FORM_LABELS: Record<FormResult, string> = {
  W: 'G',
  D: 'E',
  L: 'P',
};

function FormGuide({ form, label }: { form: FormResult[]; label: string }) {
  const pts = form.reduce((s, r) => s + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0);
  const max = form.length * 3;
  return (
    <div>
      <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>{label}</div>
      {form.length === 0 ? (
        <div style={{ fontSize: 11, opacity: 0.4, fontStyle: 'italic' }}>Sin datos</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 3 }}>
            {form.map((r, i) => (
              <div
                key={i}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 4,
                  backgroundColor: FORM_COLORS[r],
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#fff',
                }}
              >
                {FORM_LABELS[r]}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>{pts} de {max} pts</div>
        </>
      )}
    </div>
  );
}

function TeamCrest({ url, name }: { url?: string; name: string }) {
  if (!url) {
    return (
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          backgroundColor: 'rgba(255,255,255,0.12)',
          border: '2px solid rgba(255,255,255,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 16,
          fontWeight: 700,
          color: 'rgba(255,255,255,0.7)',
        }}
      >
        {name.slice(0, 2).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={name}
      style={{ width: 48, height: 48, objectFit: 'contain' }}
    />
  );
}

interface MatchProbs {
  homeWin: number;
  draw: number;
  awayWin: number;
  hasData: boolean;
}

function formPts(form: FormResult[]): number {
  return form.reduce((s, r) => s + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0);
}

function computeProbs(
  teamVenuePoints: number | undefined,
  oppVenuePoints: number | undefined,
  teamForm: FormResult[],
  oppForm: FormResult[],
  teamIsHome: boolean,
): MatchProbs {
  const hasVenue = teamVenuePoints !== undefined && oppVenuePoints !== undefined;
  const hasForm = teamForm.length > 0 || oppForm.length > 0;
  if (!hasVenue && !hasForm) return { homeWin: 0, draw: 0, awayWin: 0, hasData: false };

  // Base strength from venue-specific season points (0 if no data)
  const teamBase = teamVenuePoints ?? 0;
  const oppBase = oppVenuePoints ?? 0;

  // Form momentum (0-15 range normalized to 0-1)
  const teamFormScore = teamForm.length > 0 ? formPts(teamForm) / 15 : 0.5;
  const oppFormScore = oppForm.length > 0 ? formPts(oppForm) / 15 : 0.5;

  // Combine: 60% venue pts weight, 40% form weight
  const total = teamBase + oppBase;
  const teamStrength = total > 0
    ? (teamBase / total) * 0.6 + teamFormScore * 0.4
    : 0.5 * 0.6 + teamFormScore * 0.4;
  const oppStrength = total > 0
    ? (oppBase / total) * 0.6 + oppFormScore * 0.4
    : 0.5 * 0.6 + oppFormScore * 0.4;

  // Draw probability: higher when teams are balanced, min 15%
  const balance = 1 - Math.abs(teamStrength - oppStrength) * 2;
  const drawProb = Math.max(0.15, Math.min(0.35, balance * 0.30));

  // Split remaining between win/loss proportionally
  const remaining = 1 - drawProb;
  const sumStr = teamStrength + oppStrength || 1;
  const teamWinProb = (teamStrength / sumStr) * remaining;
  const oppWinProb = (oppStrength / sumStr) * remaining;

  return teamIsHome
    ? { homeWin: teamWinProb, draw: drawProb, awayWin: oppWinProb, hasData: true }
    : { homeWin: oppWinProb, draw: drawProb, awayWin: teamWinProb, hasData: true };
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export function DetailPanel({ detail, onClose }: DetailPanelProps) {
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const nm = detail.nextMatch;
  const isHome = nm?.venue === 'HOME';

  return (
    <aside
      data-testid="detail-panel"
      className="detail-panel"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: isMobile ? '100vw' : 340,
        height: '100vh',
        backgroundColor: '#1e293b',
        color: '#fff',
        padding: isMobile ? 16 : 20,
        overflowY: 'auto',
        boxShadow: '-4px 0 20px rgba(0,0,0,0.3)',
        animation: 'slideIn 220ms ease-out',
        zIndex: 100,
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>{detail.team.teamName}</h2>
          {detail.team.coachName && (
            <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>
              DT: {detail.team.coachName}
            </div>
          )}
        </div>
        <button
          data-testid="close-detail"
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#fff',
            fontSize: isMobile ? 24 : 20,
            cursor: 'pointer',
            padding: isMobile ? '8px 12px' : '4px',
            margin: isMobile ? '-8px -12px' : 0,
          }}
        >
          ✕
        </button>
      </div>

      {nm && (
        <section data-testid="next-match" style={{ marginTop: 16 }}>

          {/* 1. Título + jornada / fecha / hora / localía / estadio */}
          {nm.scoreHome === undefined && (
            <h3 style={{ fontSize: 13, opacity: 0.5, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: 1 }}>
              Próximo partido
            </h3>
          )}
          <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 12 }}>
            {nm.matchday && <span>Jornada {nm.matchday}{nm.scoreHome === undefined ? ' · ' : ''}</span>}
            {nm.scoreHome === undefined && formatDateTime(nm.kickoffUtc, detail.header.timezone)}
            {nm.scoreHome === undefined && nm.venue && <span> · {venueLabel(nm.venue)}</span>}
            {nm.venueName && <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>{nm.venueName}</div>}
          </div>

          {/* 2. Escudos */}
          {(() => {
            const played = nm.scoreHome !== undefined;
            const homeScore = isHome ? nm.scoreHome : nm.scoreAway;
            const awayScore = isHome ? nm.scoreAway : nm.scoreHome;
            return (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <TeamCrest
                      url={isHome ? detail.team.crestUrl : nm.opponentCrestUrl}
                      name={isHome ? detail.team.teamName : (nm.opponentName ?? '')}
                    />
                  </div>
                  <div style={{ fontSize: 11, marginTop: 4, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingInline: 4 }}>
                    {isHome ? detail.team.teamName : (nm.opponentName ?? 'Rival')}
                  </div>
                </div>
                {played ? (
                  <div style={{ textAlign: 'center', flexShrink: 0, width: 72 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 2, lineHeight: 1 }}>
                      {homeScore ?? '-'} <span style={{ opacity: 0.4, fontSize: 16 }}>-</span> {awayScore ?? '-'}
                    </div>
                    <div style={{ fontSize: 10, opacity: 0.4, marginTop: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Final</div>
                  </div>
                ) : (
                  <span style={{ fontSize: 16, fontWeight: 700, opacity: 0.4, flexShrink: 0, width: 40, textAlign: 'center', display: 'block' }}>vs</span>
                )}
                <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <TeamCrest
                      url={isHome ? nm.opponentCrestUrl : detail.team.crestUrl}
                      name={isHome ? (nm.opponentName ?? '') : detail.team.teamName}
                    />
                  </div>
                  <div style={{ fontSize: 11, marginTop: 4, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingInline: 4 }}>
                    {isHome ? (nm.opponentName ?? 'Rival') : detail.team.teamName}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* 3. Estimación heurística */}
          {nm.scoreHome === undefined && (() => {
            const teamVenuePts = isHome ? detail.team.homeGoalStats?.points : detail.team.awayGoalStats?.points;
            const oppVenuePts = isHome ? nm.opponentAwayGoalStats?.points : nm.opponentHomeGoalStats?.points;
            const probs = computeProbs(
              teamVenuePts, oppVenuePts,
              detail.team.recentForm ?? [], nm.opponentRecentForm ?? [],
              isHome,
            );
            if (!probs.hasData) return null;
            const homeName = isHome ? detail.team.teamName : (nm.opponentName ?? 'Local');
            const awayName = isHome ? (nm.opponentName ?? 'Visitante') : detail.team.teamName;
            const barStyle = (pctVal: number, color: string) => ({
              height: 6, borderRadius: 3, backgroundColor: color,
              width: `${Math.round(pctVal * 100)}%`, transition: 'width 0.3s',
            });
            return (
              <div data-testid="match-estimate" style={{ marginBottom: 16, padding: '12px 16px', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: 18, fontWeight: 800 }}>{pct(probs.homeWin)}</div>
                    <div style={{ fontSize: 10, opacity: 0.5, marginTop: 2 }}>{homeName}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: '#6b7280' }}>{pct(probs.draw)}</div>
                    <div style={{ fontSize: 10, opacity: 0.5, marginTop: 2 }}>Empate</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 18, fontWeight: 800 }}>{pct(probs.awayWin)}</div>
                    <div style={{ fontSize: 10, opacity: 0.5, marginTop: 2 }}>{awayName}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 2, borderRadius: 3, overflow: 'hidden' }}>
                  <div style={barStyle(probs.homeWin, '#22c55e')} />
                  <div style={barStyle(probs.draw, '#6b7280')} />
                  <div style={barStyle(probs.awayWin, '#ef4444')} />
                </div>
                <div style={{ fontSize: 10, opacity: 0.35, marginTop: 8, textAlign: 'center' }}>
                  Estimación heurística · forma reciente + rendimiento por localía
                </div>
              </div>
            );
          })()}

          {/* 4. Forma reciente de ambos */}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <FormGuide
              form={(isHome ? detail.team.recentForm : nm.opponentRecentForm) ?? []}
              label={isHome ? detail.team.teamName : (nm.opponentName ?? 'Local')}
            />
            <FormGuide
              form={(isHome ? nm.opponentRecentForm : detail.team.recentForm) ?? []}
              label={isHome ? (nm.opponentName ?? 'Visitante') : detail.team.teamName}
            />
          </div>

          {/* 5. Rendimiento local / visitante */}
          {(() => {
            const entries: { label: string; home?: typeof detail.team.goalStats; away?: typeof detail.team.goalStats }[] = [];
            if (detail.team.homeGoalStats || detail.team.awayGoalStats)
              entries.push({ label: detail.team.teamName, home: detail.team.homeGoalStats, away: detail.team.awayGoalStats });
            if (nm.opponentHomeGoalStats || nm.opponentAwayGoalStats)
              entries.push({ label: nm.opponentName ?? 'Rival', home: nm.opponentHomeGoalStats, away: nm.opponentAwayGoalStats });
            if (entries.length === 0) return null;
            function VenueRow({ stats, venue }: { stats: typeof detail.team.goalStats; venue: string }) {
              if (!stats) return null;
              return (
                <tr style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <td style={{ padding: '5px 0' }}>{venue}</td>
                  <td style={{ textAlign: 'center', padding: '5px 6px' }}>{stats.goalsFor}</td>
                  <td style={{ textAlign: 'center', padding: '5px 6px' }}>{stats.goalsAgainst}</td>
                  <td style={{ textAlign: 'center', padding: '5px 6px', fontWeight: 600, color: stats.goalDifference > 0 ? '#22c55e' : stats.goalDifference < 0 ? '#ef4444' : '#6b7280' }}>
                    {stats.goalDifference > 0 ? '+' : ''}{stats.goalDifference}
                  </td>
                  <td style={{ textAlign: 'center', padding: '5px 6px', fontWeight: 700 }}>{stats.points}</td>
                </tr>
              );
            }
            return (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Rendimiento local / visitante</div>
                {entries.map((entry) => (
                  <div key={entry.label} style={{ marginBottom: 12 }}>
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left', padding: '4px 0', fontWeight: 600, fontSize: 12 }}>{entry.label}</th>
                          <th style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 400, opacity: 0.5 }}>GF</th>
                          <th style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 400, opacity: 0.5 }}>GC</th>
                          <th style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 400, opacity: 0.5 }}>DG</th>
                          <th style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 400, opacity: 0.5 }}>Pts</th>
                        </tr>
                      </thead>
                      <tbody>
                        <VenueRow stats={entry.home} venue="Local" />
                        <VenueRow stats={entry.away} venue="Visitante" />
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* 6. Goles en la temporada */}
          {(detail.team.goalStats || nm.opponentGoalStats) && (() => {
            const homeStats = isHome ? detail.team.goalStats : nm.opponentGoalStats;
            const awayStats = isHome ? nm.opponentGoalStats : detail.team.goalStats;
            const homeName = isHome ? detail.team.teamName : (nm.opponentName ?? 'Local');
            const awayName = isHome ? (nm.opponentName ?? 'Visitante') : detail.team.teamName;
            return (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Goles en la temporada</div>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ opacity: 0.5 }}>
                      <th style={{ textAlign: 'left', padding: '4px 0', fontWeight: 400 }}>Equipo</th>
                      <th style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 400 }}>GF</th>
                      <th style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 400 }}>GC</th>
                      <th style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 400 }}>DG</th>
                      <th style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 400 }}>Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {homeStats && (
                      <tr style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                        <td style={{ padding: '5px 0', fontWeight: 600 }}>{homeName}</td>
                        <td style={{ textAlign: 'center', padding: '5px 6px' }}>{homeStats.goalsFor}</td>
                        <td style={{ textAlign: 'center', padding: '5px 6px' }}>{homeStats.goalsAgainst}</td>
                        <td style={{ textAlign: 'center', padding: '5px 6px', fontWeight: 600, color: homeStats.goalDifference > 0 ? '#22c55e' : homeStats.goalDifference < 0 ? '#ef4444' : '#6b7280' }}>
                          {homeStats.goalDifference > 0 ? '+' : ''}{homeStats.goalDifference}
                        </td>
                        <td style={{ textAlign: 'center', padding: '5px 6px', fontWeight: 700 }}>{homeStats.points}</td>
                      </tr>
                    )}
                    {awayStats && (
                      <tr style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                        <td style={{ padding: '5px 0', fontWeight: 600 }}>{awayName}</td>
                        <td style={{ textAlign: 'center', padding: '5px 6px' }}>{awayStats.goalsFor}</td>
                        <td style={{ textAlign: 'center', padding: '5px 6px' }}>{awayStats.goalsAgainst}</td>
                        <td style={{ textAlign: 'center', padding: '5px 6px', fontWeight: 600, color: awayStats.goalDifference > 0 ? '#22c55e' : awayStats.goalDifference < 0 ? '#ef4444' : '#6b7280' }}>
                          {awayStats.goalDifference > 0 ? '+' : ''}{awayStats.goalDifference}
                        </td>
                        <td style={{ textAlign: 'center', padding: '5px 6px', fontWeight: 700 }}>{awayStats.points}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </section>
      )}

      {/* 7. Signals */}
      <section data-testid="explain-section" style={{ marginTop: 20 }}>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {detail.explainability.topContributions
            .filter((c) => c.signalKey !== 'FORM_POINTS_LAST_5')
            .filter((c) => !(c.signalKey === 'NEXT_MATCH_HOURS' && nm?.scoreHome !== undefined))
            .map((c) => (
              <li
                key={c.signalKey}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '6px 0',
                  fontSize: 13,
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <span>{signalLabel(c.signalKey)}</span>
                <span style={{ fontWeight: 600 }}>{signalValueLabel(c.signalKey, c.rawValue)}</span>
              </li>
            ))}
        </ul>
      </section>

    </aside>
  );
}
