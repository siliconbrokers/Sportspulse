/**
 * DetailPanel — Match detail card. Premium 2026 Design System.
 * Implements: match-detail-card-update-spec-v1
 *
 * Rendering rules (§15):
 *   PRE_MATCH  → header + prediction + form + pre-match reading + venue/season context
 *   IN_PLAY    → header only (minimal technical, §13)
 *   FINISHED   → header + final result + events (if any) + prediction evaluation + post-match reading
 *   UNKNOWN    → header only (safe fallback, §15.4)
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { useLiveMatchClock } from '../hooks/use-live-match-clock.js';
import { Info, Clock } from 'lucide-react';
import type { TeamDetailDTO } from '../types/team-detail.js';
import type { FormResult } from '../types/snapshot.js';
import type { IncidentEvent } from '../types/incidents.js';
import { formatDateTime } from '../utils/format-date.js';
import { useWindowWidth } from '../hooks/use-window-width.js';
import { buildMatchDetailViewModel, type MatchDetailViewModel, type PredictionProbsOverride } from '../utils/match-detail-viewmodel.js';
import { useMatchIncidents } from '../hooks/use-match-incidents.js';
import { PredictionExperimentalSection } from './PredictionExperimentalSection.js';
import { ProbabilityBars } from './shared/ProbabilityBars.js';
import { COMP_ID_TO_FLTV_CHANNEL } from '../utils/competition-meta.js';
import { StreamPopup } from './StreamPopup.js';

interface DetailPanelProps {
  detail: TeamDetailDTO;
  onClose: () => void;
  /** Override prediction probs (e.g. from radar liveData) to ensure consistency with PronosticoCard. */
  predictionProbsOverride?: PredictionProbsOverride;
}

// ── Shared sub-components ─────────────────────────────────────────────────────

const FORM_COLORS: Record<FormResult, string> = {
  W: '#22c55e',
  D: '#6b7280',
  L: '#ef4444',
};
const FORM_LABELS: Record<FormResult, string> = { W: 'G', D: 'E', L: 'P' };

function FormGuide({ form, formCrests }: { form: string[]; formCrests?: (string | null)[] }) {
  const typed = form as FormResult[];
  const pts = typed.reduce((s, r) => s + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0);
  const max = typed.length * 3;
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {typed.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--sp-text-35)', fontStyle: 'italic' }}>Sin datos</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap' }}>
            {typed.map((r, i) => {
              const crest = formCrests?.[i];
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                  {/* Escudo del rival */}
                  {crest ? (
                    <img src={crest} alt="" style={{ width: 14, height: 14, objectFit: 'contain', flexShrink: 0 }} />
                  ) : (
                    <div style={{
                      width: 14, height: 14, borderRadius: '50%',
                      border: '1px solid var(--sp-border)',
                      background: 'var(--sp-surface)',
                    }} />
                  )}
                  {/* Resultado */}
                  <div style={{
                    width: 20, height: 20, borderRadius: 4,
                    backgroundColor: FORM_COLORS[r],
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 800, color: '#fff',
                  }}>
                    {FORM_LABELS[r]}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--sp-text-35)', marginTop: 5 }}>{pts} de {max} pts</div>
        </>
      )}
    </div>
  );
}

function TeamCrest({ url, name, size = 56 }: { url?: string; name: string; size?: number }) {
  if (!url) {
    return (
      <div style={{
        width: size, height: size, borderRadius: '50%',
        backgroundColor: 'var(--sp-border-8)',
        border: '2px solid var(--sp-border-8)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.round(size * 0.3), fontWeight: 700,
        color: 'var(--sp-text-55)',
        flexShrink: 0,
      }}>
        {name.slice(0, 2).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={name}
      style={{
        width: size, height: size,
        objectFit: 'contain',
        filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.35))',
        flexShrink: 0,
      }}
    />
  );
}

function pct(v?: number | null): string {
  return v != null ? `${Math.round(v * 100)}%` : '–';
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10,
      color: 'var(--sp-text-35)',
      marginBottom: 8,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      fontWeight: 700,
    }}>
      {children}
    </div>
  );
}

// ── Fixed header: crests + score + badge (§6, always visible) ────────────────

function MatchHeader({
  vm,
  timezone,
  headerLabel,
  kickoffUtc,
  matchPeriod,
  elapsedMinutes,
}: {
  vm: MatchDetailViewModel;
  timezone: string;
  headerLabel: string;
  kickoffUtc?: string;
  matchPeriod?: string;
  elapsedMinutes?: number | null;
}) {
  const isLive    = vm.uiState === 'IN_PLAY';
  const isZombie  = vm.uiState === 'PENDING_CONFIRMATION';
  const clockText = useLiveMatchClock(kickoffUtc ?? null, matchPeriod ?? null, isLive && !isZombie, elapsedMinutes);
  const hasScore  = vm.score.home != null && vm.score.away != null;

  // Color semántico del score según estado
  const scoreColor =
    isLive   ? '#f97316'                // naranja neon — en juego confirmado
    : isZombie ? '#f59e0b'             // ámbar — pendiente de confirmación
    : 'var(--sp-text)';                // blanco/negro — resto

  const scoreShadow =
    isLive   ? 'drop-shadow(0 0 10px rgba(249,115,22,0.7))'
    : isZombie ? 'drop-shadow(0 0 6px rgba(245,158,11,0.35))'
    : 'none';

  return (
    <div>
      {/* Metadata row */}
      <div style={{ fontSize: 12, color: 'var(--sp-text-40)', marginBottom: 10, textAlign: 'center' }}>
        {vm.matchday && <span>Jornada {vm.matchday} · </span>}
        {vm.utcDate && formatDateTime(vm.utcDate, timezone)}
        {vm.venueName && (
          <div style={{ fontSize: 11, color: 'var(--sp-text-35)', marginTop: 3 }}>
            📍 {vm.venueName}
          </div>
        )}
      </div>

      {/* Crests + score */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12, gap: 8 }}>
        {/* Home team */}
        <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
            <TeamCrest url={vm.homeTeam.crest} name={vm.homeTeam.name} size={56} />
          </div>
          <div style={{
            fontSize: 12, fontWeight: 900,
            color: 'var(--sp-text)',
            wordBreak: 'break-word',
            paddingInline: 4, letterSpacing: '-0.01em',
          }}>
            {vm.homeTeam.name}
          </div>
          {vm.homeTeam.coachName && (
            <div style={{ fontSize: 10, marginTop: 2, color: 'var(--sp-text-35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingInline: 4 }}>
              {vm.homeTeam.coachName}
            </div>
          )}
        </div>

        {/* Score or vs */}
        {hasScore ? (
          <div style={{ textAlign: 'center', flexShrink: 0, width: 80, position: 'relative' }}>
            {/* Aura glow — solo para partidos EN JUEGO confirmados */}
            {isLive && (
              <div style={{
                position: 'absolute',
                top: '50%', left: '50%',
                transform: 'translate(-50%, -60%)',
                width: 64, height: 32,
                borderRadius: '50%',
                background: 'rgba(249,115,22,0.18)',
                filter: 'blur(12px)',
                pointerEvents: 'none',
              }} />
            )}
            <div style={{
              fontSize: 28, fontWeight: 900, letterSpacing: 3, lineHeight: 1,
              color: scoreColor,
              filter: scoreShadow,
              position: 'relative',
            }}>
              {vm.score.home} <span style={{ color: 'var(--sp-text-35)', fontSize: 20, fontWeight: 400 }}>-</span> {vm.score.away}
            </div>

            {/* Badge de estado debajo del score */}
            {isLive ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, marginTop: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    backgroundColor: '#ef4444', display: 'inline-block',
                    animation: 'pulse-live 2s cubic-bezier(0.4,0,0.6,1) infinite',
                  }} />
                  <span style={{ fontSize: 9, color: '#ef4444', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    LIVE
                  </span>
                </div>
                {clockText && (
                  <span style={{
                    fontSize: 12, fontWeight: 800, color: '#f97316',
                    fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em',
                    lineHeight: 1,
                  }}>
                    {clockText}
                  </span>
                )}
              </div>
            ) : isZombie ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 6 }}>
                <Clock size={11} color="#f59e0b" strokeWidth={2.5} />
                <span style={{ fontSize: 9, color: '#f59e0b', fontWeight: 700, letterSpacing: '0.05em' }}>
                  Confirmando
                </span>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 9, color: 'var(--sp-text-40)', marginTop: 5, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>
                  Final
                </div>
                {vm.score.homePenalties != null && vm.score.awayPenalties != null && (
                  <div style={{ fontSize: 10, color: 'var(--sp-text-40)', marginTop: 3, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                    PEN {vm.score.homePenalties} - {vm.score.awayPenalties}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div style={{ textAlign: 'center', flexShrink: 0, width: 60 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--sp-text-35)', display: 'block' }}>vs</span>
          </div>
        )}

        {/* Away team */}
        <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
            <TeamCrest url={vm.awayTeam.crest} name={vm.awayTeam.name} size={56} />
          </div>
          <div style={{
            fontSize: 12, fontWeight: 900,
            color: 'var(--sp-text)',
            wordBreak: 'break-word',
            paddingInline: 4, letterSpacing: '-0.01em',
          }}>
            {vm.awayTeam.name}
          </div>
          {vm.awayTeam.coachName && (
            <div style={{ fontSize: 10, marginTop: 2, color: 'var(--sp-text-35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingInline: 4 }}>
              {vm.awayTeam.coachName}
            </div>
          )}
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--sp-border)', marginBottom: 12 }} />
    </div>
  );
}

// ── Badge helper — maps outcome status to display label+color ─────────────────

function derivePredictionBadge(
  outcomeStatus?: string,
  uiState?: string,
): { label: string; color: string } | null {
  if (uiState === 'PENDING_CONFIRMATION')
    return { label: 'Confirmando resultado', color: '#f59e0b' };
  // PRE_MATCH: solo muestra badge cuando hay outcome explícito
  if (uiState === 'PRE_MATCH')
    return outcomeStatus === 'pending' ? { label: 'Pendiente', color: '#6b7280' } : null;
  // Predicción pendiente de evaluación (en curso o aún no iniciado)
  if (outcomeStatus === 'in_progress' || outcomeStatus === 'pending')
    return { label: 'Pendiente', color: '#6b7280' };
  // Post-partido — evaluación binaria
  if (outcomeStatus === 'hit')           return { label: 'Acertado',     color: '#22c55e' };
  if (outcomeStatus === 'miss')          return { label: 'Fallado',      color: '#ef4444' };
  if (outcomeStatus === 'not_evaluable') return { label: 'No evaluable', color: '#6b7280' };
  return null;
}

// ── PRE_MATCH body (§7) ───────────────────────────────────────────────────────

function PreMatchBody({
  vm,
  detail,
  uiState,
  isMobile,
}: {
  vm: MatchDetailViewModel;
  detail: TeamDetailDTO;
  uiState: string;
  isMobile?: boolean;
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
        const statusBadge = derivePredictionBadge(vm.prediction!.outcomeStatus, 'PRE_MATCH');

        return (
          <div
            data-testid="match-estimate"
            style={{
              marginBottom: 12,
              padding: '14px 16px',
              backgroundColor: 'var(--sp-border-4)',
              borderRadius: 12,
              border: '1px solid var(--sp-border-8)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--sp-text-35)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Pronóstico
              </div>
              {statusBadge && (
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  padding: '3px 10px', borderRadius: 20,
                  backgroundColor: `${statusBadge.color}18`,
                  color: statusBadge.color,
                  border: `1px solid ${statusBadge.color}40`,
                }}>
                  {statusBadge.label}
                </span>
              )}
            </div>

            {/* §7.1 — Probability bars (shared component — mismos colores que PronosticoCard y RadarCard) */}
            {hasProbs && (
              <ProbabilityBars
                probHomeWin={vm.prediction!.homeProbability!}
                probDraw={vm.prediction!.drawProbability!}
                probAwayWin={vm.prediction!.awayProbability!}
                label=""
              />
            )}
          </div>
        );
      })()}


      {/* §7.2 — Form block */}
      {vm.form && (
        <div style={{
          display: 'flex',
          gap: 12,
          marginBottom: 12,
          padding: '12px 14px',
          background: 'var(--sp-border-4)',
          borderRadius: 10,
          border: '1px solid var(--sp-border)',
          overflow: 'hidden',
        }}>
          <FormGuide form={vm.form.home} formCrests={vm.form.homeCrests} />
          <div style={{ width: 1, background: 'var(--sp-border)', flexShrink: 0 }} />
          <FormGuide form={vm.form.away} formCrests={vm.form.awayCrests} />
        </div>
      )}

      {/* Tournament goals/points — ordered by pts desc, then GD desc */}
      {(detail.team.goalStats || nm?.opponentGoalStats) && (() => {
        const rows = [
          { name: detail.team.teamName, stats: detail.team.goalStats },
          { name: nm?.opponentName ?? 'Rival', stats: nm?.opponentGoalStats },
        ]
          .filter((r) => r.stats != null)
          .sort((a, b) => {
            const ptsDiff = (b.stats?.points ?? 0) - (a.stats?.points ?? 0);
            if (ptsDiff !== 0) return ptsDiff;
            return (b.stats?.goalDifference ?? 0) - (a.stats?.goalDifference ?? 0);
          });

        return (
          <div style={{ marginBottom: 20 }}>
            <div style={{
              background: 'var(--sp-border-4)',
              borderRadius: 10,
              border: '1px solid var(--sp-border)',
              overflow: 'hidden',
              padding: '2px 12px 6px',
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px 0 4px', fontWeight: 700, fontSize: 9, color: 'var(--sp-text-35)', letterSpacing: '0.06em' }}>GOLES / PUNTOS DEL TORNEO</th>
                    <th style={{ textAlign: 'center', padding: '8px 6px 4px', fontWeight: 400, fontSize: 10, color: 'var(--sp-text-35)' }}>GF</th>
                    <th style={{ textAlign: 'center', padding: '8px 6px 4px', fontWeight: 400, fontSize: 10, color: 'var(--sp-text-35)' }}>GC</th>
                    <th style={{ textAlign: 'center', padding: '8px 6px 4px', fontWeight: 400, fontSize: 10, color: 'var(--sp-text-35)' }}>DG</th>
                    <th style={{ textAlign: 'center', padding: '8px 6px 4px', fontWeight: 400, fontSize: 10, color: 'var(--sp-text-35)' }}>Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ name, stats }) => {
                    const gd = stats!.goalDifference;
                    return (
                      <tr key={name} style={{ borderTop: '1px solid var(--sp-border)' }}>
                        <td style={{ padding: '5px 0', fontSize: 12, fontWeight: 700, color: 'var(--sp-text-88)' }}>{name}</td>
                        <td style={{ textAlign: 'center', padding: '5px 6px', fontSize: 12 }}>{stats!.goalsFor}</td>
                        <td style={{ textAlign: 'center', padding: '5px 6px', fontSize: 12 }}>{stats!.goalsAgainst}</td>
                        <td style={{ textAlign: 'center', padding: '5px 6px', fontSize: 12, fontWeight: 700, color: gd > 0 ? '#22c55e' : gd < 0 ? '#ef4444' : '#6b7280' }}>
                          {gd > 0 ? '+' : ''}{gd}
                        </td>
                        <td style={{ textAlign: 'center', padding: '5px 6px', fontSize: 12, fontWeight: 700, color: 'var(--sp-text)' }}>{stats!.points}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* Venue performance tables — mini-bento */}
      {(() => {
        const entries: { label: string; home?: typeof detail.team.goalStats; away?: typeof detail.team.goalStats }[] = [];
        if (detail.team.homeGoalStats || detail.team.awayGoalStats)
          entries.push({ label: detail.team.teamName, home: detail.team.homeGoalStats, away: detail.team.awayGoalStats });
        if (nm?.opponentHomeGoalStats || nm?.opponentAwayGoalStats)
          entries.push({ label: nm?.opponentName ?? 'Rival', home: nm?.opponentHomeGoalStats, away: nm?.opponentAwayGoalStats });
        if (entries.length === 0) return null;

        function VenueRow({ stats, venue }: { stats: typeof detail.team.goalStats; venue: string }) {
          if (!stats) return null;
          const gd = stats.goalDifference;
          return (
            <tr style={{ borderTop: '1px solid var(--sp-border)' }}>
              <td style={{ padding: '5px 0', fontSize: 12, color: 'var(--sp-text-55)' }}>{venue}</td>
              <td style={{ textAlign: 'center', padding: '5px 6px', fontSize: 12 }}>{stats.goalsFor}</td>
              <td style={{ textAlign: 'center', padding: '5px 6px', fontSize: 12 }}>{stats.goalsAgainst}</td>
              <td style={{ textAlign: 'center', padding: '5px 6px', fontSize: 12, fontWeight: 700, color: gd > 0 ? '#22c55e' : gd < 0 ? '#ef4444' : '#6b7280' }}>
                {gd > 0 ? '+' : ''}{gd}
              </td>
              <td style={{ textAlign: 'center', padding: '5px 6px', fontSize: 12, fontWeight: 700, color: 'var(--sp-text)' }}>{stats.points}</td>
            </tr>
          );
        }

        return (
          <div style={{ marginBottom: 20 }}>
            <SectionLabel>Rendimiento local / visitante</SectionLabel>
            {entries.map((entry) => (
              <div
                key={entry.label}
                style={{
                  marginBottom: 10,
                  background: 'var(--sp-border-4)',
                  borderRadius: 10,
                  border: '1px solid var(--sp-border)',
                  overflow: 'hidden',
                  padding: '2px 12px 6px',
                }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '8px 0 4px', fontWeight: 700, fontSize: 11, color: 'var(--sp-text-88)' }}>{entry.label}</th>
                      <th style={{ textAlign: 'center', padding: '8px 6px 4px', fontWeight: 400, fontSize: 10, color: 'var(--sp-text-35)' }}>GF</th>
                      <th style={{ textAlign: 'center', padding: '8px 6px 4px', fontWeight: 400, fontSize: 10, color: 'var(--sp-text-35)' }}>GC</th>
                      <th style={{ textAlign: 'center', padding: '8px 6px 4px', fontWeight: 400, fontSize: 10, color: 'var(--sp-text-35)' }}>DG</th>
                      <th style={{ textAlign: 'center', padding: '8px 6px 4px', fontWeight: 400, fontSize: 10, color: 'var(--sp-text-35)' }}>Pts</th>
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

/** Deterministic phrase selector */
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

// ── IncidentTimeline — Premium with conductor line ────────────────────────────

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
  label,
  isMobile,
}: {
  events: IncidentEvent[];
  label?: string;
  isMobile?: boolean;
}) {
  if (events.length === 0) return null;

  const sorted = [...events].sort(
    (a, b) => b.minute - a.minute || (b.minuteExtra ?? 0) - (a.minuteExtra ?? 0),
  );

  // Goals only for neon badge highlights
  const isGoal = (type: string) => ['GOAL', 'OWN_GOAL', 'PENALTY_GOAL'].includes(type);
  const isCard = (type: string) => type.includes('CARD');

  return (
    <div style={{ marginBottom: 20 }}>
      {label && <SectionLabel>{label}</SectionLabel>}

      {/* Container with conductor line */}
      <div style={{ position: 'relative', paddingLeft: isMobile ? 0 : 32 }}>

        {/* Vertical conductor line (desktop only) */}
        {!isMobile && (
          <div style={{
            position: 'absolute',
            left: 14,
            top: 0,
            bottom: 0,
            width: 2,
            background: 'linear-gradient(to bottom, transparent, var(--sp-border-8) 8%, var(--sp-border-8) 92%, transparent)',
            borderRadius: 1,
          }} />
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {sorted.map((ev, i) => {
            const isHome = ev.teamSide === 'HOME';
            const icon = INCIDENT_ICONS[ev.type] ?? '•';
            const detail = INCIDENT_DETAIL[ev.type];
            const timeStr = `${ev.minute}${ev.minuteExtra ? `+${ev.minuteExtra}` : ''}'`;
            const isSub = ev.type === 'SUBSTITUTION';
            const goal = isGoal(ev.type);
            const card = isCard(ev.type);

            // Neon badge for goals
            const badgeBg = goal
              ? 'var(--sp-primary-10)'
              : card
              ? 'rgba(239,68,68,0.08)'
              : 'transparent';
            const badgeBorder = goal
              ? '1px solid var(--sp-primary-22)'
              : card
              ? '1px solid rgba(239,68,68,0.2)'
              : 'none';

            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '5px 8px',
                  borderRadius: 8,
                  backgroundColor: badgeBg,
                  border: badgeBorder,
                  flexDirection: isMobile ? 'row' : isHome ? 'row' : 'row-reverse',
                  transition: 'background 0.15s',
                }}
              >
                {/* Minuto */}
                <span style={{
                  fontSize: 10,
                  color: goal ? 'var(--sp-primary)' : 'var(--sp-text-40)',
                  minWidth: 26,
                  textAlign: isMobile ? 'left' : isHome ? 'right' : 'left',
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: goal ? 700 : 400,
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
                  textAlign: isMobile ? 'left' : isHome ? 'left' : 'right',
                }}>
                  {ev.playerName && (
                    <span style={{
                      fontSize: 12,
                      color: goal ? 'var(--sp-text)' : 'var(--sp-text-88)',
                      fontWeight: goal ? 700 : 400,
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {ev.playerName}
                      {detail && <span style={{ fontSize: 10, color: 'var(--sp-text-40)', marginLeft: 4 }}>{detail}</span>}
                    </span>
                  )}
                  {ev.assistName && !isSub && (
                    <span style={{ fontSize: 10, color: 'var(--sp-text-40)', display: 'block' }}>
                      Ast: {ev.assistName}
                    </span>
                  )}
                  {isSub && ev.playerOutName && (
                    <span style={{ fontSize: 10, color: 'var(--sp-text-35)', display: 'block' }}>
                      ↓ {ev.playerOutName}
                    </span>
                  )}
                </div>

              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Share button ───────────────────────────────────────────────────────────────

function ShareButton({ vm }: { vm: MatchDetailViewModel }) {
  const handleShare = useCallback(async () => {
    const score = vm.score.home != null && vm.score.away != null
      ? `${vm.score.home}-${vm.score.away}`
      : '';
    const text = `${vm.homeTeam.name} ${score} ${vm.awayTeam.name} · SportPulse`;

    if (navigator.share) {
      await navigator.share({ title: 'SportPulse', text }).catch(() => null);
    } else {
      await navigator.clipboard.writeText(text).catch(() => null);
    }
  }, [vm]);

  return (
    <button
      onClick={handleShare}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 16px',
        borderRadius: 20,
        border: '1px solid var(--sp-border-8)',
        background: 'var(--sp-surface)',
        color: 'var(--sp-text-55)',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = 'var(--sp-primary-40)';
        el.style.color = 'var(--sp-primary)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = 'var(--sp-border-8)';
        el.style.color = 'var(--sp-text-55)';
      }}
    >
      <span>↗</span>
      <span>Compartir</span>
    </button>
  );
}

// ── FinishedBody ──────────────────────────────────────────────────────────────

function FinishedBody({
  vm,
  hideEvents = false,
  isMobile = false,
}: {
  vm: MatchDetailViewModel;
  hideEvents?: boolean;
  isMobile?: boolean;
}) {
  const pred = vm.prediction;
  const hasEvents = !hideEvents && vm.events.length > 0;
  const noEventsData = !hasEvents && hideEvents === false;

  // Poisson unification: prefer expectedWinner vs actualWinner when both are available.
  // Falls back to backend outcomeStatus when probs are unavailable.
  const effectiveOutcomeStatus =
    pred?.expectedWinner && pred?.actualWinner
      ? pred.expectedWinner === pred.actualWinner
        ? 'hit'
        : 'miss'
      : pred?.outcomeStatus;

  const isHit = effectiveOutcomeStatus === 'hit';
  const isMiss = effectiveOutcomeStatus === 'miss';

  const narrativeBorder = isHit ? '#22c55e' : isMiss ? '#ef4444' : 'var(--sp-border-8)';
  const narrativeBg     = isHit ? 'rgba(34,197,94,0.06)' : isMiss ? 'rgba(239,68,68,0.05)' : 'var(--sp-border-4)';

  // Padding de la evaluación: más grande cuando no hay eventos para llenar el espacio
  const predPadding = noEventsData ? '20px 20px' : '14px 16px';

  return (
    <>
      {/* ── Caso A: hay eventos → lista cronológica de goles ────────────────── */}
      {hasEvents && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>Goles del partido</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {vm.events
              .slice()
              .sort((a, b) => b.minute - a.minute || (b.extraMinute ?? 0) - (a.extraMinute ?? 0))
              .map((ev) => (
                <div
                  key={ev.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12,
                    justifyContent: ev.teamSide === 'HOME' ? 'flex-start' : 'flex-end',
                    padding: '5px 10px',
                    borderRadius: 8,
                    background: 'var(--sp-primary-04)',
                    border: '1px solid var(--sp-primary-10)',
                  }}
                >
                  <span style={{
                    fontSize: 10,
                    color: 'var(--sp-primary)',
                    fontWeight: 700,
                    minWidth: 28,
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    flexShrink: 0,
                  }}>
                    {ev.minute}{ev.extraMinute ? `+${ev.extraMinute}` : ''}'
                  </span>
                  <span style={{ flexShrink: 0 }}>⚽</span>
                  {ev.playerName && (
                    <span style={{
                      color: 'var(--sp-text-88)',
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {ev.playerName}
                    </span>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ── Caso B: sin datos de eventos → estado de cortesía ───────────────── */}
      {noEventsData && (
        <div style={{
          marginBottom: isMobile ? 10 : 12,
          padding: '14px 16px',
          borderRadius: 12,
          border: '1px solid var(--sp-border)',
          background: 'var(--sp-border-4)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
        }}>
          <div style={{
            flexShrink: 0,
            marginTop: 1,
            color: 'var(--sp-text-20)',
          }}>
            <Info size={16} strokeWidth={1.5} />
          </div>
          <div>
            <div style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--sp-text-40)',
              marginBottom: 3,
            }}>
              Resumen detallado no disponible
            </div>
            <div style={{
              fontSize: 11,
              color: 'var(--sp-text-30)',
              lineHeight: 1.5,
            }}>
              Esta liga no provee el detalle de eventos. El marcador final está confirmado.
            </div>
          </div>
        </div>
      )}

      {/* ── Evaluación del pronóstico — más prominente sin eventos ──────────── */}
      {pred && (() => {
        const badge = derivePredictionBadge(effectiveOutcomeStatus, 'FINISHED');
        return (
          <div
            data-testid="match-estimate"
            style={{
              marginBottom: 12,
              padding: predPadding,
              backgroundColor: narrativeBg,
              borderRadius: 12,
              border: `1px solid ${narrativeBorder}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <SectionLabel>Evaluación del pronóstico</SectionLabel>
              {badge && (
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  padding: '3px 10px', borderRadius: 20,
                  backgroundColor: `${badge.color}18`,
                  color: badge.color,
                  border: `1px solid ${badge.color}40`,
                }}>
                  {badge.label}
                </span>
              )}
            </div>

            {pred.expectedWinner && pred.actualWinner && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                fontSize: noEventsData ? 13 : 12,
                marginBottom: 12,
                color: 'var(--sp-text-88)',
              }}>
                <span>
                  Esperado: <strong>
                    {pred.expectedWinner === 'HOME' ? vm.homeTeam.name
                      : pred.expectedWinner === 'AWAY' ? vm.awayTeam.name
                      : 'Empate'}
                  </strong>
                </span>
                <span>
                  Real: <strong>
                    {pred.actualWinner === 'HOME' ? vm.homeTeam.name
                      : pred.actualWinner === 'AWAY' ? vm.awayTeam.name
                      : 'Empate'}
                  </strong>
                </span>
              </div>
            )}

            {pred.deviation && (
              <div style={{
                fontSize: 12,
                color: 'var(--sp-text-40)',
                marginBottom: pred.narrativeTag ? 8 : 0,
              }}>
                {DEVIATION_READABLE[pred.deviation] ?? pred.deviation}
              </div>
            )}

            {pred.narrativeTag && NARRATIVE_PHRASES[pred.narrativeTag] && (
              <div style={{
                fontSize: noEventsData ? 14 : 13,
                color: 'var(--sp-text-55)',
                fontStyle: 'italic',
                lineHeight: 1.5,
                marginTop: noEventsData ? 4 : 0,
              }}>
                {pickPhrase(vm.matchId ?? '', pred.narrativeTag)}
              </div>
            )}
          </div>
        );
      })()}

      {/* Share button — sube en mobile cuando no hay eventos */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        marginTop: isMobile && noEventsData ? 4 : 8,
        marginBottom: 8,
      }}>
        <ShareButton vm={vm} />
      </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DetailPanel({ detail, onClose, predictionProbsOverride }: DetailPanelProps) {
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';

  // Keyboard Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Swipe-down to close on mobile
  const touchStartY = useRef<number | null>(null);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  }, []);
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const delta = e.changedTouches[0].clientY - touchStartY.current;
    if (delta > 80) onClose();
    touchStartY.current = null;
  }, [onClose]);

  const [streamOpen, setStreamOpen] = useState(false);

  const vm = buildMatchDetailViewModel(detail, predictionProbsOverride);
  const nm = detail.nextMatch;

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

  const headerLabel =
    vm.uiState === 'IN_PLAY'              ? ''
    : vm.uiState === 'PENDING_CONFIRMATION' ? ''
    : vm.uiState === 'FINISHED'           ? 'Último partido'
    : vm.uiState === 'PRE_MATCH'          ? 'Próximo partido'
    : '';

  return (
    <>
      {/* Overlay — solo desktop: cierra al hacer click fuera del panel */}
      {!isMobile && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0,
            zIndex: 99,
          }}
        />
      )}
    <aside
      data-testid="detail-panel"
      className="detail-panel"
      onTouchStart={isMobile ? handleTouchStart : undefined}
      onTouchEnd={isMobile ? handleTouchEnd : undefined}
      style={{
        position: 'fixed', top: 0, right: 0,
        width: isMobile ? '100vw' : 360,
        height: '100vh',
        backgroundColor: 'var(--sp-surface)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        color: 'var(--sp-text)',
        padding: isMobile ? '16px 16px 32px' : '20px 22px 32px',
        overflowY: 'auto',
        boxShadow: '-4px 0 40px rgba(0,0,0,0.25)',
        animation: 'slideIn 220ms ease-out',
        zIndex: 100,
        boxSizing: 'border-box',
      }}
    >
      {/* Close bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{
          fontSize: 10,
          fontWeight: 800,
          color: 'var(--sp-text-35)',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
        }}>
          {headerLabel}
        </span>
        {/* Swipe hint on mobile */}
        {isMobile && (
          <div style={{
            width: 36, height: 4, borderRadius: 2,
            background: 'var(--sp-border-8)',
            position: 'absolute',
            top: 8, left: '50%',
            transform: 'translateX(-50%)',
          }} />
        )}
        <button
          data-testid="close-detail"
          onClick={onClose}
          style={{
            background: 'var(--sp-border-4)',
            border: '1px solid var(--sp-border)',
            borderRadius: '50%',
            width: isMobile ? 36 : 30,
            height: isMobile ? 36 : 30,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--sp-text-55)',
            fontSize: isMobile ? 16 : 14,
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget;
            el.style.borderColor = 'var(--sp-primary-40)';
            el.style.color = 'var(--sp-primary)';
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget;
            el.style.borderColor = 'var(--sp-border)';
            el.style.color = 'var(--sp-text-55)';
          }}
        >
          ✕
        </button>
      </div>

      {/* Team identity — only when no match context */}
      {!nm && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
          <TeamCrest url={detail.team.crestUrl} name={detail.team.teamName} size={56} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--sp-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {detail.team.teamName}
            </div>
            {detail.team.coachName && (
              <div style={{ fontSize: 11, color: 'var(--sp-text-40)', marginTop: 3 }}>{detail.team.coachName}</div>
            )}
          </div>
        </div>
      )}

      {nm && (
        <section data-testid="next-match">
          {/* §6 — Fixed header */}
          <MatchHeader
            vm={vm}
            timezone={detail.header.timezone}
            headerLabel={headerLabel}
            kickoffUtc={nm?.kickoffUtc}
            matchPeriod={nm?.matchPeriod}
            elapsedMinutes={nm?.elapsedMinutes}
          />

          {/* PRE_MATCH */}
          {vm.uiState === 'PRE_MATCH' && (
            <PreMatchBody vm={vm} detail={detail} uiState="PRE_MATCH" isMobile={isMobile} />
          )}

          {/* PRE_MATCH — experimental prediction section (auto-hides if flag off or no data) */}
          {vm.uiState === 'PRE_MATCH' && (
            <PredictionExperimentalSection
              matchId={vm.matchId}
              competitionId={detail.header.competitionId}
            />
          )}

          {/* PENDING_CONFIRMATION — zombie: >180 min sin confirmación de resultado */}
          {vm.uiState === 'PENDING_CONFIRMATION' && (
            <>
              {(() => {
                const badge = derivePredictionBadge(vm.prediction?.outcomeStatus, 'PENDING_CONFIRMATION');
                return (
                  <div
                    data-testid="match-estimate"
                    style={{
                      marginBottom: 10, padding: '12px 16px',
                      backgroundColor: 'var(--sp-border-4)',
                      borderRadius: 12,
                      border: '1px solid rgba(245,158,11,0.25)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--sp-text-35)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        Pronóstico
                      </div>
                      {badge && (
                        <span style={{
                          fontSize: 10, fontWeight: 700,
                          padding: '3px 10px', borderRadius: 20,
                          backgroundColor: `${badge.color}18`,
                          color: badge.color,
                          border: `1px solid ${badge.color}40`,
                        }}>
                          {badge.label}
                        </span>
                      )}
                    </div>
                    {vm.prediction && (
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--sp-text-88)' }}>
                        {vm.prediction.label}
                      </div>
                    )}
                  </div>
                );
              })()}
              {incidentEvents ? (
                <IncidentTimeline
                  events={incidentEvents}
                  label="Incidentes registrados"
                  isMobile={isMobile}
                />
              ) : null}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 12, color: '#f59e0b',
                textAlign: 'center', justifyContent: 'center',
                marginTop: 12, padding: '12px 16px',
                backgroundColor: 'rgba(245,158,11,0.06)',
                borderRadius: 10,
                border: '1px solid rgba(245,158,11,0.18)',
              }}>
                <Clock size={13} color="#f59e0b" strokeWidth={2} />
                <span style={{ fontWeight: 600 }}>
                  Resultado pendiente de confirmación oficial
                </span>
              </div>
            </>
          )}

          {/* IN_PLAY */}
          {vm.uiState === 'IN_PLAY' && (
            <>
              {/* Stream popup — solo cuando la competición tiene canal registrado */}
              {(() => {
                const channel = COMP_ID_TO_FLTV_CHANNEL[detail.header.competitionId];
                if (!channel) return null;
                return (
                  <>
                    <button
                      onClick={() => setStreamOpen(true)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 7,
                        width: '100%',
                        marginBottom: 12,
                        padding: '11px 16px',
                        backgroundColor: 'rgba(34,197,94,0.08)',
                        borderRadius: 10,
                        border: '1px solid rgba(34,197,94,0.25)',
                        color: '#22c55e',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'background-color 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(34,197,94,0.14)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(34,197,94,0.08)';
                      }}
                    >
                      <span style={{ fontSize: 15 }}>▶</span>
                      Ver en vivo · {channel.label}
                    </button>
                    {streamOpen && (
                      <StreamPopup
                        sourcePageUrl={channel.sourcePageUrl}
                        fallbackUrl={channel.fallbackUrl}
                        label={channel.label}
                        onClose={() => setStreamOpen(false)}
                      />
                    )}
                  </>
                );
              })()}
              {(() => {
                const badge = derivePredictionBadge(vm.prediction?.outcomeStatus, 'IN_PLAY');
                return (
                  <div
                    data-testid="match-estimate"
                    style={{
                      marginBottom: 10,
                      padding: '12px 16px',
                      backgroundColor: 'var(--sp-border-4)',
                      borderRadius: 12,
                      border: '1px solid var(--sp-border)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--sp-text-35)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        Pronóstico
                      </div>
                      {badge && (
                        <span style={{
                          fontSize: 10, fontWeight: 700,
                          padding: '3px 10px', borderRadius: 20,
                          backgroundColor: `${badge.color}18`,
                          color: badge.color,
                          border: `1px solid ${badge.color}40`,
                        }}>
                          {badge.label}
                        </span>
                      )}
                    </div>
                    {vm.prediction && (
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--sp-text-88)' }}>
                        {vm.prediction.label}
                      </div>
                    )}
                  </div>
                );
              })()}
              {incidentEvents ? (
                <IncidentTimeline
                  events={incidentEvents}
                  label="Incidentes"
                  isMobile={isMobile}
                />
              ) : null}
            </>
          )}

          {/* FINISHED */}
          {vm.uiState === 'FINISHED' && (
            <>
              {incidentEvents ? (
                <IncidentTimeline
                  events={incidentEvents}
                  label="Resumen del partido"
                  isMobile={isMobile}
                />
              ) : null}
              <FinishedBody vm={vm} hideEvents={incidentEvents != null} isMobile={isMobile} />
            </>
          )}

          {/* UNKNOWN */}
          {vm.uiState === 'UNKNOWN' && (
            <PreMatchBody vm={vm} detail={detail} uiState="UNKNOWN" isMobile={isMobile} />
          )}
        </section>
      )}

      {/* API quota warning — only relevant during live matches (quota blocks real-time events) */}
      {incidents?.quotaExhausted && vm.uiState === 'IN_PLAY' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 16px',
          fontSize: 11,
          color: '#ef4444',
          borderTop: '1px solid rgba(239,68,68,0.2)',
        }}>
          <span style={{ fontSize: 13 }}>⚠</span>
          <span>Eventos no disponibles — cuota diaria de API agotada</span>
        </div>
      )}
    </aside>
    </>
  );
}
