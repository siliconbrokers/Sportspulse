import { useEffect } from 'react';
import type { TeamDetailDTO } from '../types/team-detail.js';
import type { FormResult } from '../types/snapshot.js';
import { formatDateTime } from '../utils/format-date.js';
import { venueLabel, signalLabel, signalValueLabel } from '../utils/labels.js';

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

const HOME_BONUS = 2;

interface MatchEstimate {
  label: string;
  color: string;
}

function estimateFavorite(
  teamForm: FormResult[],
  opponentForm: FormResult[],
  teamName: string,
  opponentName: string,
  isHome: boolean,
): MatchEstimate {
  if (teamForm.length === 0 && opponentForm.length === 0) {
    return { label: 'Sin datos suficientes', color: 'rgba(255,255,255,0.5)' };
  }

  const teamPts = teamForm.reduce((s, r) => s + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0);
  const oppPts = opponentForm.reduce((s, r) => s + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0);

  const teamAdj = teamPts + (isHome ? HOME_BONUS : 0);
  const oppAdj = oppPts + (isHome ? 0 : HOME_BONUS);
  const diff = teamAdj - oppAdj;

  if (Math.abs(diff) <= 1) return { label: 'Partido parejo', color: '#6b7280' };
  const favName = diff > 0 ? teamName : opponentName;
  if (Math.abs(diff) >= 5) return { label: `Favorito: ${favName}`, color: '#22c55e' };
  return { label: `Leve ventaja: ${favName}`, color: '#facc15' };
}

export function DetailPanel({ detail, onClose }: DetailPanelProps) {
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
            fontSize: 20,
            cursor: 'pointer',
          }}
        >
          ✕
        </button>
      </div>

      {/* Estimación de favorito */}
      {nm && (() => {
        const teamForm = detail.team.recentForm ?? [];
        const oppForm = nm.opponentRecentForm ?? [];
        const estimate = estimateFavorite(
          teamForm, oppForm,
          detail.team.teamName, nm.opponentName ?? 'Rival',
          isHome,
        );
        return (
          <div
            data-testid="match-estimate"
            style={{
              marginTop: 12,
              padding: '12px 16px',
              backgroundColor: 'rgba(255,255,255,0.08)',
              borderRadius: 8,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 700, color: estimate.color }}>
              {estimate.label}
            </div>
            <div style={{ fontSize: 10, opacity: 0.4, marginTop: 6 }}>
              Estimación basada en forma reciente y localía
            </div>
          </div>
        );
      })()}

      {/* Próximo partido */}
      {nm && (
        <section data-testid="next-match" style={{ marginTop: 20 }}>
          <h3 style={{ fontSize: 13, opacity: 0.5, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: 1 }}>
            Próximo partido
          </h3>

          {/* Jornada, fecha, venue y estadio */}
          <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 12 }}>
            {nm.matchday && <span>Jornada {nm.matchday}{nm.scoreHome === undefined ? ' · ' : ''}</span>}
            {nm.scoreHome === undefined && formatDateTime(nm.kickoffUtc, detail.header.timezone)}
            {nm.scoreHome === undefined && nm.venue && <span> · {venueLabel(nm.venue)}</span>}
            {nm.venueName && <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>{nm.venueName}</div>}
          </div>

          {/* Escudos enfrentados */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
              marginBottom: 16,
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <TeamCrest
                url={isHome ? detail.team.crestUrl : nm.opponentCrestUrl}
                name={isHome ? detail.team.teamName : (nm.opponentName ?? '')}
              />
              <div style={{ fontSize: 11, marginTop: 4, opacity: 0.8 }}>
                {isHome ? detail.team.teamName : (nm.opponentName ?? 'Rival')}
              </div>
            </div>
            <span style={{ fontSize: 16, fontWeight: 700, opacity: 0.4 }}>vs</span>
            <div style={{ textAlign: 'center' }}>
              <TeamCrest
                url={isHome ? nm.opponentCrestUrl : detail.team.crestUrl}
                name={isHome ? (nm.opponentName ?? '') : detail.team.teamName}
              />
              <div style={{ fontSize: 11, marginTop: 4, opacity: 0.8 }}>
                {isHome ? (nm.opponentName ?? 'Rival') : detail.team.teamName}
              </div>
            </div>
          </div>

          {/* Forma reciente de ambos */}
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

          {/* Goles comparativos */}
          {(detail.team.goalStats || nm.opponentGoalStats) && (() => {
            const homeStats = isHome ? detail.team.goalStats : nm.opponentGoalStats;
            const awayStats = isHome ? nm.opponentGoalStats : detail.team.goalStats;
            const homeName = isHome ? detail.team.teamName : (nm.opponentName ?? 'Local');
            const awayName = isHome ? (nm.opponentName ?? 'Visitante') : detail.team.teamName;

            return (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                  Goles en la temporada
                </div>
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

          {/* Rendimiento local / visitante */}
          {(() => {
            const entries: { label: string; home?: typeof detail.team.goalStats; away?: typeof detail.team.goalStats }[] = [];
            if (detail.team.homeGoalStats || detail.team.awayGoalStats) {
              entries.push({ label: detail.team.teamName, home: detail.team.homeGoalStats, away: detail.team.awayGoalStats });
            }
            if (nm.opponentHomeGoalStats || nm.opponentAwayGoalStats) {
              entries.push({ label: nm.opponentName ?? 'Rival', home: nm.opponentHomeGoalStats, away: nm.opponentAwayGoalStats });
            }
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
                <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                  Rendimiento local / visitante
                </div>
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
        </section>
      )}

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
