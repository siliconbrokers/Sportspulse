import { useEffect } from 'react';
import type { TeamDetailDTO } from '../types/team-detail.js';
import type { FormResult } from '../types/snapshot.js';
import { formatDateTime, formatDate } from '../utils/format-date.js';
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
      <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
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

// ── Poisson + Dixon-Coles model ───────────────────────────────────────────────

/** P(X = k) for Poisson distribution with mean λ */
function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/**
 * Dixon-Coles τ correction factor for low-scoring scorelines.
 * Corrects the systematic under-prediction of 0-0, 1-0, 0-1, 1-1.
 * ρ ≈ -0.13 (empirically validated in the original D-C paper).
 */
function tau(h: number, a: number, lh: number, la: number, rho: number): number {
  if (h === 0 && a === 0) return 1 - lh * la * rho;
  if (h === 0 && a === 1) return 1 + lh * rho;
  if (h === 1 && a === 0) return 1 + la * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

type GoalStats = { playedGames: number; lambdaAttack: number; lambdaDefense: number };

/**
 * Poisson + Dixon-Coles match probability model.
 *
 * Uses time-decay weighted λ values (pre-computed on backend, ξ=0.006/day).
 * Applies Dixon-Coles τ correction on low-scoring scorelines (0-0, 1-0, 0-1, 1-1).
 *
 * λ_home = (team_venue_lambdaAttack + opp_venue_lambdaDefense) / 2
 * λ_away = (opp_venue_lambdaAttack  + team_venue_lambdaDefense) / 2
 */
function computeProbs(
  teamIsHome: boolean,
  teamHomeGS: GoalStats | undefined,
  teamAwayGS: GoalStats | undefined,
  teamGS:     GoalStats | undefined,
  oppHomeGS:  GoalStats | undefined,
  oppAwayGS:  GoalStats | undefined,
  oppGS:      GoalStats | undefined,
): MatchProbs {
  const MIN_GAMES = 3;
  const MAX_GOALS = 7;
  const DC_RHO    = -0.13; // Dixon-Coles correlation parameter

  // Use venue-specific stats when enough games played, fall back to season totals
  const teamVenueGS = teamIsHome
    ? (teamHomeGS && teamHomeGS.playedGames >= MIN_GAMES ? teamHomeGS : teamGS)
    : (teamAwayGS && teamAwayGS.playedGames >= MIN_GAMES ? teamAwayGS : teamGS);

  const oppVenueGS = teamIsHome
    ? (oppAwayGS && oppAwayGS.playedGames >= MIN_GAMES ? oppAwayGS : oppGS)
    : (oppHomeGS && oppHomeGS.playedGames >= MIN_GAMES ? oppHomeGS : oppGS);

  if (!teamVenueGS || teamVenueGS.playedGames < MIN_GAMES ||
      !oppVenueGS  || oppVenueGS.playedGames  < MIN_GAMES) {
    return { homeWin: 0, draw: 0, awayWin: 0, hasData: false };
  }

  // λ = average of team's decay-weighted attack rate and opponent's decay-weighted defense rate
  const lambdaTeam = (teamVenueGS.lambdaAttack + oppVenueGS.lambdaDefense) / 2;
  const lambdaOpp  = (oppVenueGS.lambdaAttack  + teamVenueGS.lambdaDefense) / 2;

  const lambdaHome = teamIsHome ? lambdaTeam : lambdaOpp;
  const lambdaAway = teamIsHome ? lambdaOpp  : lambdaTeam;

  let pHomeWin = 0;
  let pDraw    = 0;
  let pAwayWin = 0;

  for (let h = 0; h <= MAX_GOALS; h++) {
    const ph = poissonPmf(lambdaHome, h);
    for (let a = 0; a <= MAX_GOALS; a++) {
      // Dixon-Coles correction on low-scoring scorelines
      const p = ph * poissonPmf(lambdaAway, a) * tau(h, a, lambdaHome, lambdaAway, DC_RHO);
      if (h > a) pHomeWin += p;
      else if (h === a) pDraw += p;
      else pAwayWin += p;
    }
  }

  const total = pHomeWin + pDraw + pAwayWin || 1;
  return {
    homeWin: pHomeWin / total,
    draw:    pDraw    / total,
    awayWin: pAwayWin / total,
    hasData: true,
  };
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
  const isLive = nm?.matchStatus === 'IN_PROGRESS';

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
      {/* Botón cerrar + título */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 1 }}>
          {nm ? (isLive ? 'En juego' : nm.scoreHome === undefined ? 'Próximo partido' : 'Último partido') : ''}
        </span>
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
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>

      {/* Identidad del equipo — solo cuando no hay próximo partido */}
      {!nm && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <TeamCrest url={detail.team.crestUrl} name={detail.team.teamName} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {detail.team.teamName}
            </div>
            {detail.team.coachName && (
              <div style={{ fontSize: 11, opacity: 0.45, marginTop: 2 }}>
                {detail.team.coachName}
              </div>
            )}
          </div>
        </div>
      )}

      {nm && (
        <section data-testid="next-match" style={{ marginTop: 0 }}>

          {/* 1. Jornada / fecha / hora / localía / estadio */}
          <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 12 }}>
            {nm.matchday && <span>Jornada {nm.matchday} · </span>}
            {formatDateTime(nm.kickoffUtc, detail.header.timezone)}
            {nm.venueName && <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>{nm.venueName}</div>}
          </div>

          {/* 2. Escudos */}
          {(() => {
            const played = nm.scoreHome !== undefined;
            // LEFT crest is always the HOME team, RIGHT is always AWAY — scores match directly
            const homeScore = nm.scoreHome;
            const awayScore = nm.scoreAway;
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
                  {(() => {
                    const coach = isHome ? detail.team.coachName : nm.opponentCoachName;
                    return coach ? (
                      <div style={{ fontSize: 10, marginTop: 2, opacity: 0.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingInline: 4 }}>
                        {coach}
                      </div>
                    ) : null;
                  })()}
                </div>
                {played ? (
                  <div style={{ textAlign: 'center', flexShrink: 0, width: 72 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 2, lineHeight: 1, color: isLive ? '#f97316' : undefined }}>
                      {homeScore ?? '-'} <span style={{ opacity: 0.4, fontSize: 16 }}>-</span> {awayScore ?? '-'}
                    </div>
                    {isLive ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 4 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#ef4444', display: 'inline-block', animation: 'pulse 1.4s infinite' }} />
                        <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>En juego</span>
                      </div>
                    ) : (
                      <div style={{ fontSize: 10, opacity: 0.4, marginTop: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Final</div>
                    )}
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
                  {(() => {
                    const coach = isHome ? nm.opponentCoachName : detail.team.coachName;
                    return coach ? (
                      <div style={{ fontSize: 10, marginTop: 2, opacity: 0.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingInline: 4 }}>
                        {coach}
                      </div>
                    ) : null;
                  })()}
                </div>
              </div>
            );
          })()}

          {/* 3. Probabilidades Poisson — solo en partidos futuros (oculto si live o finalizado) */}
          {nm.scoreHome === undefined && !isLive && (() => {
            const probs = computeProbs(
              isHome,
              detail.team.homeGoalStats,
              detail.team.awayGoalStats,
              detail.team.goalStats,
              nm.opponentHomeGoalStats,
              nm.opponentAwayGoalStats,
              nm.opponentGoalStats,
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
                <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                  Pronóstico
                </div>
                <div style={{ display: 'flex', marginBottom: 8 }}>
                  <div style={{ width: `${Math.round(probs.homeWin * 100)}%`, textAlign: 'left', overflow: 'hidden' }}>
                    <div style={{ fontSize: 18, fontWeight: 800 }}>{pct(probs.homeWin)}</div>
                    <div style={{ fontSize: 10, opacity: 0.5, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{homeName}</div>
                  </div>
                  <div style={{ width: `${Math.round(probs.draw * 100)}%`, textAlign: 'center', overflow: 'hidden', flexShrink: 0 }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: '#6b7280' }}>{pct(probs.draw)}</div>
                    <div style={{ fontSize: 10, opacity: 0.5, marginTop: 2 }}>Empate</div>
                  </div>
                  <div style={{ width: `${Math.round(probs.awayWin * 100)}%`, textAlign: 'right', overflow: 'hidden' }}>
                    <div style={{ fontSize: 18, fontWeight: 800 }}>{pct(probs.awayWin)}</div>
                    <div style={{ fontSize: 10, opacity: 0.5, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{awayName}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 2, borderRadius: 3, overflow: 'hidden' }}>
                  <div style={barStyle(probs.homeWin, '#22c55e')} />
                  <div style={barStyle(probs.draw, '#6b7280')} />
                  <div style={barStyle(probs.awayWin, '#ef4444')} />
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

          {/* 6. Goles / Puntos del torneo */}
          {(detail.team.goalStats || nm.opponentGoalStats) && (() => {
            const homeStats = isHome ? detail.team.goalStats : nm.opponentGoalStats;
            const awayStats = isHome ? nm.opponentGoalStats : detail.team.goalStats;
            const homeName = isHome ? detail.team.teamName : (nm.opponentName ?? 'Local');
            const awayName = isHome ? (nm.opponentName ?? 'Visitante') : detail.team.teamName;
            return (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Goles / Puntos del torneo</div>
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
