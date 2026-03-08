/**
 * DetailPanel — Match detail card.
 * Implements: match-detail-card-update-spec-v1
 *
 * Rendering rules (§15):
 *   PRE_MATCH  → header + prediction + form + pre-match reading + venue/season context
 *   IN_PLAY    → header only (minimal technical, §13)
 *   FINISHED   → header + final result + events (if any) + prediction evaluation + post-match reading
 *   UNKNOWN    → header only (safe fallback, §15.4)
 */
import { useEffect } from 'react';
import type { TeamDetailDTO } from '../types/team-detail.js';
import type { FormResult } from '../types/snapshot.js';
import type { IncidentEvent } from '../types/incidents.js';
import { formatDateTime } from '../utils/format-date.js';
import { signalLabel, signalValueLabel } from '../utils/labels.js';
import { useWindowWidth } from '../hooks/use-window-width.js';
import { buildMatchDetailViewModel, type MatchDetailViewModel } from '../utils/match-detail-viewmodel.js';
import { useMatchIncidents } from '../hooks/use-match-incidents.js';

interface DetailPanelProps {
  detail: TeamDetailDTO;
  onClose: () => void;
}

// ── Shared sub-components ─────────────────────────────────────────────────────

const FORM_COLORS: Record<FormResult, string> = {
  W: '#22c55e',
  D: '#6b7280',
  L: '#ef4444',
};
const FORM_LABELS: Record<FormResult, string> = { W: 'G', D: 'E', L: 'P' };

function FormGuide({ form, label }: { form: string[]; label: string }) {
  const typed = form as FormResult[];
  const pts = typed.reduce((s, r) => s + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0);
  const max = typed.length * 3;
  return (
    <div>
      <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
      {typed.length === 0 ? (
        <div style={{ fontSize: 11, opacity: 0.4, fontStyle: 'italic' }}>Sin datos</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 3 }}>
            {typed.map((r, i) => (
              <div key={i} style={{ width: 24, height: 24, borderRadius: 4, backgroundColor: FORM_COLORS[r], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff' }}>
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
      <div style={{ width: 48, height: 48, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.12)', border: '2px solid rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>
        {name.slice(0, 2).toUpperCase()}
      </div>
    );
  }
  return <img src={url} alt={name} style={{ width: 48, height: 48, objectFit: 'contain' }} />;
}

function pct(v?: number | null): string {
  return v != null ? `${Math.round(v * 100)}%` : '–';
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
      {children}
    </div>
  );
}

// ── Fixed header: crests + score + badge (§6, always visible) ────────────────

function MatchHeader({
  vm,
  timezone,
  headerLabel,
}: {
  vm: MatchDetailViewModel;
  timezone: string;
  headerLabel: string;
}) {
  const isLive = vm.uiState === 'IN_PLAY';
  const hasScore = vm.score.home != null && vm.score.away != null;

  return (
    <div>
      {/* Metadata row */}
      <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 12 }}>
        {vm.matchday && <span>Jornada {vm.matchday} · </span>}
        {vm.utcDate && formatDateTime(vm.utcDate, timezone)}
        {vm.venueName && <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>{vm.venueName}</div>}
      </div>

      {/* Crests + score */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
        {/* Home team */}
        <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <TeamCrest url={vm.homeTeam.crest} name={vm.homeTeam.name} />
          </div>
          <div style={{ fontSize: 11, marginTop: 4, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingInline: 4 }}>
            {vm.homeTeam.name}
          </div>
          {vm.homeTeam.coachName && (
            <div style={{ fontSize: 10, marginTop: 2, opacity: 0.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingInline: 4 }}>
              {vm.homeTeam.coachName}
            </div>
          )}
        </div>

        {/* Score or vs */}
        {hasScore ? (
          <div style={{ textAlign: 'center', flexShrink: 0, width: 72 }}>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 2, lineHeight: 1, color: isLive ? '#f97316' : undefined }}>
              {vm.score.home} <span style={{ opacity: 0.4, fontSize: 16 }}>-</span> {vm.score.away}
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

        {/* Away team */}
        <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <TeamCrest url={vm.awayTeam.crest} name={vm.awayTeam.name} />
          </div>
          <div style={{ fontSize: 11, marginTop: 4, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingInline: 4 }}>
            {vm.awayTeam.name}
          </div>
          {vm.awayTeam.coachName && (
            <div style={{ fontSize: 10, marginTop: 2, opacity: 0.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingInline: 4 }}>
              {vm.awayTeam.coachName}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Badge helper — maps outcome status to display label+color ─────────────────

function derivePredictionBadge(
  outcomeStatus?: string,
  uiState?: string,
): { label: string; color: string } {
  if (uiState === 'IN_PLAY' || outcomeStatus === 'in_progress')
    return { label: 'En juego', color: '#f97316' };
  if (outcomeStatus === 'hit')          return { label: 'Acertado',    color: '#22c55e' };
  if (outcomeStatus === 'miss')         return { label: 'Fallado',     color: '#ef4444' };
  if (outcomeStatus === 'not_evaluable') return { label: 'No evaluable', color: '#6b7280' };
  return { label: 'Pendiente', color: '#6b7280' };
}

// ── PRE_MATCH body (§7) ───────────────────────────────────────────────────────

function PreMatchBody({
  vm,
  detail,
  uiState,
}: {
  vm: MatchDetailViewModel;
  detail: TeamDetailDTO;
  uiState: string;
}) {
  const nm = detail.nextMatch;
  const isHome = nm?.venue === 'HOME';
  const hasProbs =
    vm.prediction?.homeProbability != null &&
    vm.prediction?.drawProbability != null &&
    vm.prediction?.awayProbability != null;

  return (
    <>
      {/* §7.1 — Prediction block */}
      {vm.prediction && (() => {
        const badge = derivePredictionBadge(vm.prediction!.outcomeStatus, uiState);
        return (
        <div
          data-testid="match-estimate"
          style={{ marginBottom: 16, padding: '12px 16px', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Pronóstico
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, backgroundColor: `${badge.color}22`, color: badge.color, border: `1px solid ${badge.color}44` }}>
              {badge.label}
            </span>
          </div>

          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)', marginBottom: hasProbs ? 8 : 0 }}>
            {vm.prediction.label}
          </div>

          {/* §7.1 — Probabilities */}
          {hasProbs && (
            <>
              <div style={{ display: 'flex', marginBottom: 6 }}>
                <div style={{ width: pct(vm.prediction.homeProbability), textAlign: 'left' }}>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{pct(vm.prediction.homeProbability)}</div>
                  <div style={{ fontSize: 10, opacity: 0.5, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vm.homeTeam.name}</div>
                </div>
                <div style={{ width: pct(vm.prediction.drawProbability), textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#6b7280' }}>{pct(vm.prediction.drawProbability)}</div>
                  <div style={{ fontSize: 10, opacity: 0.5, marginTop: 2 }}>Empate</div>
                </div>
                <div style={{ width: pct(vm.prediction.awayProbability), textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{pct(vm.prediction.awayProbability)}</div>
                  <div style={{ fontSize: 10, opacity: 0.5, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vm.awayTeam.name}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 2, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: 6, borderRadius: 3, backgroundColor: '#22c55e', width: pct(vm.prediction.homeProbability), transition: 'width 0.3s' }} />
                <div style={{ height: 6, borderRadius: 3, backgroundColor: '#6b7280', width: pct(vm.prediction.drawProbability), transition: 'width 0.3s' }} />
                <div style={{ height: 6, borderRadius: 3, backgroundColor: '#ef4444', width: pct(vm.prediction.awayProbability), transition: 'width 0.3s' }} />
              </div>
            </>
          )}
        </div>
        );
      })()}

      {/* §7.3 — Short pre-match reading */}
      {vm.preMatchReading && (
        <div style={{ fontSize: 12, opacity: 0.55, marginBottom: 16, fontStyle: 'italic' }}>
          {vm.preMatchReading}
        </div>
      )}

      {/* §7.2 — Form block */}
      {vm.form && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <FormGuide form={vm.form.home} label={vm.homeTeam.name} />
          <FormGuide form={vm.form.away} label={vm.awayTeam.name} />
        </div>
      )}

      {/* Venue performance tables — pre-match context, hidden in FINISHED (§12) */}
      {(() => {
        const entries: { label: string; home?: typeof detail.team.goalStats; away?: typeof detail.team.goalStats }[] = [];
        if (detail.team.homeGoalStats || detail.team.awayGoalStats)
          entries.push({ label: detail.team.teamName, home: detail.team.homeGoalStats, away: detail.team.awayGoalStats });
        if (nm?.opponentHomeGoalStats || nm?.opponentAwayGoalStats)
          entries.push({ label: nm?.opponentName ?? 'Rival', home: nm?.opponentHomeGoalStats, away: nm?.opponentAwayGoalStats });
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
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>Rendimiento local / visitante</SectionLabel>
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

      {/* Tournament goals/points — pre-match context, hidden in FINISHED (§12) */}
      {(detail.team.goalStats || nm?.opponentGoalStats) && (() => {
        const homeStats = isHome ? detail.team.goalStats : nm?.opponentGoalStats;
        const awayStats = isHome ? nm?.opponentGoalStats : detail.team.goalStats;
        return (
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>Goles / Puntos del torneo</SectionLabel>
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
                    <td style={{ padding: '5px 0', fontWeight: 600 }}>{vm.homeTeam.name}</td>
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
                    <td style={{ padding: '5px 0', fontWeight: 600 }}>{vm.awayTeam.name}</td>
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

      {/* Signals — pre-match only */}
      <section data-testid="explain-section" style={{ marginTop: 4 }}>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {detail.explainability.topContributions
            .filter((c) => c.signalKey !== 'FORM_POINTS_LAST_5')
            .map((c) => (
              <li key={c.signalKey} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <span>{signalLabel(c.signalKey)}</span>
                <span style={{ fontWeight: 600 }}>{signalValueLabel(c.signalKey, c.rawValue)}</span>
              </li>
            ))}
        </ul>
      </section>
    </>
  );
}

// ── FINISHED body (§8) ────────────────────────────────────────────────────────

const NARRATIVE_PHRASES: Record<string, string[]> = {
  LOGICAL_RESULT: [
    'La lógica se impuso.',
    'El favorito cumplió. Sin dramas.',
    'Guión previsible, resultado cantado.',
    'Los números no mintieron.',
    'Todo según lo esperado.',
  ],
  SURPRISE: [
    '¡Se cayó el libreto! El favorito no apareció.',
    '¡Nadie lo vio venir! El tablero mintió.',
    'El de abajo levantó la mano. Histórico.',
    'Puro corazón contra las probabilidades.',
    '¡Sorpresón! Los cálculos quedaron en el vestuario.',
    'Se armó. El favorito se fue con las manos vacías.',
  ],
  MORE_BALANCED_THAN_EXPECTED: [
    'Más peleado de lo que indicaban los números.',
    'Nadie regaló nada. Los dos se dejaron todo.',
    'Más trabado de lo previsto. Fue guerra.',
    'Los papeles dijeron una cosa, la cancha dijo otra.',
  ],
  MORE_OPEN_THAN_EXPECTED: [
    'El partido rompió el guión previsto.',
    'Lluvia de goles que nadie esperaba.',
    'Se abrió el partido y voló todo el libreto.',
    'Festival de goles. Las defensas se olvidaron de defenderse.',
  ],
};

/** Deterministic phrase selector: same matchId → same phrase, different matches → variety. */
function pickPhrase(matchId: string, key: string): string {
  const pool = NARRATIVE_PHRASES[key];
  if (!pool || pool.length === 0) return key;
  const hash = [...matchId].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) & 0xffff, 0);
  return pool[hash % pool.length];
}

const DEVIATION_READABLE: Record<string, string> = {
  LOW:    'Sin sorpresas',
  MEDIUM: 'Salió más parejo de lo esperado',
  HIGH:   'Resultado inesperado',
};

const WINNER_LABELS = {
  HOME:  (name: string) => `Ganó ${name}`,
  AWAY:  (name: string) => `Ganó ${name}`,
  DRAW:  () => 'Empate',
};

// ── IncidentTimeline ──────────────────────────────────────────────────────────

const INCIDENT_ICONS: Record<string, string> = {
  GOAL:            '⚽',
  OWN_GOAL:        '⚽',
  PENALTY_GOAL:    '⚽',
  PENALTY_MISSED:  '❌',
  YELLOW_CARD:     '🟨',
  RED_CARD:        '🟥',
  YELLOW_RED_CARD: '🟨🟥',
  SUBSTITUTION:    '↕',
  VAR:             '📺',
};

const INCIDENT_DETAIL: Record<string, string> = {
  OWN_GOAL:        '(en propia)',
  PENALTY_GOAL:    '(pen.)',
  PENALTY_MISSED:  '(pen. fallado)',
};

function IncidentTimeline({
  events,
  homeTeamName,
  awayTeamName,
  label,
}: {
  events: IncidentEvent[];
  homeTeamName: string;
  awayTeamName: string;
  label?: string;
}) {
  if (events.length === 0) return null;

  const sorted = [...events].sort(
    (a, b) => a.minute - b.minute || (a.minuteExtra ?? 0) - (b.minuteExtra ?? 0),
  );

  return (
    <div style={{ marginBottom: 16 }}>
      {label && <SectionLabel>{label}</SectionLabel>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {sorted.map((ev, i) => {
          const isHome = ev.teamSide === 'HOME';
          const icon = INCIDENT_ICONS[ev.type] ?? '•';
          const detail = INCIDENT_DETAIL[ev.type];
          const timeStr = `${ev.minute}${ev.minuteExtra ? `+${ev.minuteExtra}` : ''}'`;
          const isSub = ev.type === 'SUBSTITUTION';
          const isCard = ev.type.includes('CARD');

          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 6px',
                borderRadius: 5,
                backgroundColor: isCard ? 'rgba(255,255,255,0.03)' : 'transparent',
                flexDirection: isHome ? 'row' : 'row-reverse',
              }}
            >
              {/* Minuto */}
              <span style={{
                fontSize: 10,
                color: 'rgba(255,255,255,0.38)',
                minWidth: 26,
                textAlign: isHome ? 'right' : 'left',
                fontVariantNumeric: 'tabular-nums',
                flexShrink: 0,
              }}>
                {timeStr}
              </span>

              {/* Ícono */}
              <span style={{ fontSize: 13, flexShrink: 0 }}>{icon}</span>

              {/* Info del jugador */}
              <div style={{
                flex: 1,
                minWidth: 0,
                textAlign: isHome ? 'left' : 'right',
              }}>
                {ev.playerName && (
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ev.playerName}
                    {detail && <span style={{ fontSize: 10, opacity: 0.5, marginLeft: 4 }}>{detail}</span>}
                  </span>
                )}
                {ev.assistName && !isSub && (
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', display: 'block' }}>
                    Ast: {ev.assistName}
                  </span>
                )}
                {isSub && ev.playerOutName && (
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', display: 'block' }}>
                    ↓ {ev.playerOutName}
                  </span>
                )}
              </div>

              {/* Equipo (pequeño label) */}
              <span style={{
                fontSize: 9,
                color: 'rgba(255,255,255,0.25)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                flexShrink: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 52,
              }}>
                {isHome ? homeTeamName : awayTeamName}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── FinishedBody ──────────────────────────────────────────────────────────────

function FinishedBody({ vm, hideEvents = false }: { vm: MatchDetailViewModel; hideEvents?: boolean }) {
  const pred = vm.prediction;
  const hasEvents = !hideEvents && vm.events.length > 0;

  return (
    <>

      {/* §8.2 — Match events block */}
      {(() => {
        const totalGoals = (vm.score.home ?? 0) + (vm.score.away ?? 0);
        if (hasEvents) {
          return (
            <div style={{ marginBottom: 16 }}>
              <SectionLabel>Goles del partido</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {vm.events
                  .slice()
                  .sort((a, b) => a.minute - b.minute || (a.extraMinute ?? 0) - (b.extraMinute ?? 0))
                  .map((ev) => (
                    <div
                      key={ev.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, justifyContent: ev.teamSide === 'HOME' ? 'flex-start' : 'flex-end' }}
                    >
                      <span style={{ fontSize: 11, opacity: 0.5, minWidth: 28, textAlign: 'right' }}>
                        {ev.minute}{ev.extraMinute ? `+${ev.extraMinute}` : ''}'
                      </span>
                      <span>⚽</span>
                      {ev.playerName && <span style={{ opacity: 0.85 }}>{ev.playerName}</span>}
                    </div>
                  ))}
              </div>
            </div>
          );
        }
        // Fallback: match had goals but no timeline data available
        if (totalGoals > 0) {
          return (
            <div style={{ marginBottom: 16, fontSize: 12, opacity: 0.4, textAlign: 'center' }}>
              {totalGoals === 1 ? '1 gol' : `${totalGoals} goles`} · detalles no disponibles
            </div>
          );
        }
        return null;
      })()}

      {/* §8.3 — Prediction evaluation block with outcome badge (data-testid="match-estimate") */}
      {pred && (() => {
        const badge = derivePredictionBadge(pred.outcomeStatus, 'FINISHED');
        return (
          <div
            data-testid="match-estimate"
            style={{ marginBottom: 16, padding: '12px 14px', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 8 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <SectionLabel>Evaluación del pronóstico</SectionLabel>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 4, backgroundColor: `${badge.color}22`, color: badge.color, border: `1px solid ${badge.color}44` }}>
                {badge.label}
              </span>
            </div>

            {/* Expected vs actual winner */}
            {pred.expectedWinner && pred.actualWinner && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, marginBottom: 8, opacity: 0.85 }}>
                <span>
                  Esperado: <strong>{pred.expectedWinner === 'HOME' ? vm.homeTeam.name : pred.expectedWinner === 'AWAY' ? vm.awayTeam.name : 'Empate'}</strong>
                </span>
                <span>
                  Real: <strong>{pred.actualWinner === 'HOME' ? vm.homeTeam.name : pred.actualWinner === 'AWAY' ? vm.awayTeam.name : 'Empate'}</strong>
                </span>
              </div>
            )}

            {/* Deviation */}
            {pred.deviation && (
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
                {DEVIATION_READABLE[pred.deviation] ?? pred.deviation}
              </div>
            )}

            {/* Narrative tag */}
            {pred.narrativeTag && NARRATIVE_PHRASES[pred.narrativeTag] && (
              <div style={{ fontSize: 12, opacity: 0.55, fontStyle: 'italic' }}>
                {pickPhrase(vm.matchId ?? '', pred.narrativeTag)}
              </div>
            )}
          </div>
        );
      })()}

    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

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

  const vm = buildMatchDetailViewModel(detail);
  const nm = detail.nextMatch;

  // Hook de incidentes: solo activo en partidos en curso o finalizados
  const { data: incidents } = useMatchIncidents({
    matchId:       nm?.matchId,
    status:        nm?.matchStatus as string | null | undefined,
    homeScore:     nm?.scoreHome,
    awayScore:     nm?.scoreAway,
    competitionId: detail.header.competitionId,
    kickoffUtc:    nm?.kickoffUtc,
    homeTeamName:  vm.homeTeam.name,
    awayTeamName:  vm.awayTeam.name,
    matchday:      nm?.matchday,
  });
  const incidentEvents: IncidentEvent[] | null =
    incidents && incidents.events.length > 0 ? incidents.events : null;

  // Top bar label (§5 header)
  const headerLabel =
    vm.uiState === 'IN_PLAY' ? 'En juego'
    : vm.uiState === 'FINISHED' ? 'Último partido'
    : vm.uiState === 'PRE_MATCH' ? 'Próximo partido'
    : '';

  return (
    <aside
      data-testid="detail-panel"
      className="detail-panel"
      style={{
        position: 'fixed', top: 0, right: 0,
        width: isMobile ? '100vw' : 340,
        height: '100vh',
        backgroundColor: '#1e293b', color: '#fff',
        padding: isMobile ? 16 : 20,
        overflowY: 'auto',
        boxShadow: '-4px 0 20px rgba(0,0,0,0.3)',
        animation: 'slideIn 220ms ease-out',
        zIndex: 100,
        boxSizing: 'border-box',
      }}
    >
      {/* Close bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 1 }}>
          {headerLabel}
        </span>
        <button
          data-testid="close-detail"
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#fff', fontSize: isMobile ? 24 : 20, cursor: 'pointer', padding: isMobile ? '8px 12px' : '4px', margin: isMobile ? '-8px -12px' : 0, flexShrink: 0 }}
        >
          ✕
        </button>
      </div>

      {/* Team identity — only when no match context */}
      {!nm && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <TeamCrest url={detail.team.crestUrl} name={detail.team.teamName} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {detail.team.teamName}
            </div>
            {detail.team.coachName && (
              <div style={{ fontSize: 11, opacity: 0.45, marginTop: 2 }}>{detail.team.coachName}</div>
            )}
          </div>
        </div>
      )}

      {nm && (
        <section data-testid="next-match">
          {/* §6 — Fixed header: always visible across all states */}
          <MatchHeader vm={vm} timezone={detail.header.timezone} headerLabel={headerLabel} />

          {/* §15 — Conditional body by uiState */}

          {/* PRE_MATCH: prediction + form + context tables (§7, §15.1) */}
          {vm.uiState === 'PRE_MATCH' && (
            <PreMatchBody vm={vm} detail={detail} uiState="PRE_MATCH" />
          )}

          {/* IN_PLAY: pronóstico + timeline de incidentes (§13, §15.3) */}
          {vm.uiState === 'IN_PLAY' && (
            <>
              {vm.prediction && (() => {
                const badge = derivePredictionBadge(vm.prediction!.outcomeStatus, 'IN_PLAY');
                return (
                  <div
                    data-testid="match-estimate"
                    style={{ marginBottom: 12, padding: '10px 14px', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8 }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Pronóstico
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, backgroundColor: `${badge.color}22`, color: badge.color, border: `1px solid ${badge.color}44` }}>
                        {badge.label}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
                      {vm.prediction.label}
                    </div>
                  </div>
                );
              })()}
              {incidentEvents ? (
                <IncidentTimeline
                  events={incidentEvents}
                  homeTeamName={vm.homeTeam.name}
                  awayTeamName={vm.awayTeam.name}
                  label="Incidentes"
                />
              ) : (
                <div style={{ fontSize: 12, opacity: 0.45, textAlign: 'center', marginTop: 8 }}>
                  Partido en curso
                </div>
              )}
            </>
          )}

          {/* FINISHED: incidentes (Flashscore) o fallback a goles (MatchEventsService) + evaluación */}
          {vm.uiState === 'FINISHED' && (
            <>
              {incidentEvents ? (
                <IncidentTimeline
                  events={incidentEvents}
                  homeTeamName={vm.homeTeam.name}
                  awayTeamName={vm.awayTeam.name}
                  label="Resumen del partido"
                />
              ) : null}
              <FinishedBody vm={vm} hideEvents={incidentEvents != null} />
            </>
          )}

          {/* UNKNOWN: no finished data — treat as pre-match (§7: "UNKNOWN with no finished data") */}
          {vm.uiState === 'UNKNOWN' && (
            <PreMatchBody vm={vm} detail={detail} uiState="UNKNOWN" />
          )}
        </section>
      )}
    </aside>
  );
}
