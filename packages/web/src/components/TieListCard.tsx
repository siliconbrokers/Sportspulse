/**
 * TieListCard — tarjeta de cruce para vista de lista (full-width).
 *
 * Diferencias respecto a PrelimTieCard (columnar, ancho fijo 164px):
 *   - Ocupa el ancho completo del contenedor (apto para listas)
 *   - Partido único (sin legs): tarjeta entera clickeable → abre DetailPanel
 *   - Ida+vuelta (con legs): cabecera toggle + sección expandible Ida/Vuelta,
 *     cada pierna clickeable → abre DetailPanel con la fecha correcta
 *   - Indicador "Vuelta pendiente" si legsPerTie=2 pero solo hay leg1
 *
 * Usado en TournamentPartidosView para fases eliminatorias y previas.
 */
import { useState } from 'react';
import type { LegDTO, TieDTO } from '../types/tournament.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtLegDate(utcDate: string): string {
  try {
    return new Date(utcDate).toLocaleDateString('es-UY', {
      day: 'numeric', month: 'short', timeZone: 'America/Montevideo',
    });
  } catch {
    return '';
  }
}

function toLocalDate(utcDate: string): string {
  try {
    return new Date(utcDate).toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' });
  } catch {
    return utcDate.slice(0, 10);
  }
}

function isLive(utcDate: string | null | undefined): boolean {
  if (!utcDate) return false;
  const elapsed = (Date.now() - new Date(utcDate).getTime()) / 60_000;
  return elapsed >= 0 && elapsed <= 180;
}

// ── Crest ─────────────────────────────────────────────────────────────────────

function Crest({ url, size = 20 }: { url?: string; size?: number }) {
  return url
    ? <img src={url} alt="" style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }} />
    : <div style={{ width: size, height: size, borderRadius: '50%', background: 'var(--sp-border-8)', flexShrink: 0 }} />;
}

// ── SlotRow — fila de equipo con score agregado ───────────────────────────────

function SlotRow({
  name,
  crestUrl,
  score,
  pen,
  isWinner,
  live,
  isMobile,
}: {
  name: string;
  crestUrl?: string;
  score?: number | null;
  pen?: number | null;
  isWinner: boolean;
  live: boolean;
  isMobile: boolean;
}) {
  const scoreColor = live ? 'var(--sp-status-live)' : isWinner ? 'var(--sp-status-success)' : 'var(--sp-text-70)';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      minHeight: isMobile ? 40 : 36,
      padding: '0 10px',
    }}>
      <Crest url={crestUrl} size={isMobile ? 20 : 18} />
      <span style={{
        flex: 1, minWidth: 0,
        fontSize: isMobile ? 13 : 13,
        fontWeight: isWinner ? 700 : 500,
        color: isWinner ? 'var(--sp-text)' : 'var(--sp-text-80)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {name}
      </span>
      {score != null && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, flexShrink: 0 }}>
          <span style={{
            fontSize: isMobile ? 16 : 15,
            fontWeight: 800,
            color: scoreColor,
            fontVariantNumeric: 'tabular-nums',
            minWidth: 16,
            textAlign: 'right',
          }}>
            {score}
          </span>
          {pen != null && (
            <span style={{ fontSize: 10, color: 'var(--sp-text-40)' }}>({pen}p)</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── LegRow — pierna individual dentro de la sección expandida ─────────────────

function LegRow({
  label,
  utcDate,
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
  homePen,
  awayPen,
  onSelect,
}: {
  label: string;
  utcDate: string;
  homeTeam: { name?: string; crest?: string };
  awayTeam: { name?: string; crest?: string };
  homeScore: number | null;
  awayScore: number | null;
  homePen?: number | null;
  awayPen?: number | null;
  onSelect?: () => void;
}) {
  const live = isLive(utcDate);
  const pending = homeScore === null && awayScore === null && !live;

  return (
    <div
      onClick={(e) => { if (onSelect) { e.stopPropagation(); onSelect(); } }}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px',
        cursor: onSelect ? 'pointer' : 'default',
        borderRadius: 6,
        border: live ? '1px solid rgba(239,68,68,0.3)' : '1px solid transparent', /* live border — rgba alpha needed */
        backgroundColor: live ? 'var(--sp-status-error-soft)' : 'transparent',
        transition: 'background-color 0.12s',
      }}
      onMouseEnter={(e) => { if (onSelect) (e.currentTarget as HTMLDivElement).style.backgroundColor = live ? 'var(--sp-status-error-soft)' : 'var(--sp-border-4)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = live ? 'var(--sp-status-error-soft)' : 'transparent'; }}
    >
      {/* Label */}
      <div style={{ flexShrink: 0, minWidth: 60 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {live && (
            <span style={{
              width: 5, height: 5, borderRadius: '50%', background: 'var(--sp-status-error)', flexShrink: 0,
              animation: 'sp-badge-blink 2s ease-in-out infinite',
            }} />
          )}
          <span style={{
            fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
            color: live ? 'var(--sp-status-error)' : 'var(--sp-text-30)',
          }}>
            {label}
          </span>
        </div>
        {utcDate && (
          <div style={{ fontSize: 9, color: 'var(--sp-text-25)', marginTop: 1 }}>
            {fmtLegDate(utcDate)}
          </div>
        )}
      </div>

      {/* Equipo local */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
        <Crest url={homeTeam.crest} size={13} />
        <span style={{ fontSize: 11, color: 'var(--sp-text-70)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {homeTeam.name ?? '?'}
        </span>
      </div>

      {/* Score */}
      <div style={{ flexShrink: 0, textAlign: 'center', minWidth: 44 }}>
        {pending ? (
          <span style={{ fontSize: 10, color: 'var(--sp-text-25)' }}>— : —</span>
        ) : live ? (
          <span style={{
            fontSize: 8, fontWeight: 900, letterSpacing: '0.1em',
            padding: '2px 6px', borderRadius: 20,
            background: 'var(--sp-status-error)', color: '#fff', lineHeight: 1.6,
          }}>
            LIVE
          </span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <span style={{
              fontSize: 12, fontWeight: 700,
              color: live ? 'var(--sp-status-live)' : 'var(--sp-text-75)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {homeScore ?? '–'} : {awayScore ?? '–'}
            </span>
            {homePen != null && awayPen != null && (
              <span style={{ fontSize: 9, color: 'var(--sp-text-35)' }}>
                ({homePen} : {awayPen} p)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Equipo visitante */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, justifyContent: 'flex-end' }}>
        <span style={{ fontSize: 11, color: 'var(--sp-text-70)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
          {awayTeam.name ?? '?'}
        </span>
        <Crest url={awayTeam.crest} size={13} />
      </div>
    </div>
  );
}

// ── TieListCard ───────────────────────────────────────────────────────────────

interface TieListCardProps {
  tie: TieDTO;
  isMobile: boolean;
  legsPerTie?: 1 | 2;
  /** Callback para abrir DetailPanel. teamId + dateLocal opcional. */
  onSelectTeam?: (teamId: string, dateLocal?: string) => void;
  /** teamId actualmente en foco — para toggle-off */
  activeFocusTeamId?: string | null;
}

export function TieListCard({
  tie,
  isMobile,
  legsPerTie = 1,
  onSelectTeam,
  activeFocusTeamId,
}: TieListCardProps) {
  const [expanded, setExpanded] = useState(false);

  const winA    = tie.winnerId != null && tie.winnerId === tie.slotA.participantId;
  const winB    = tie.winnerId != null && tie.winnerId === tie.slotB.participantId;
  const hasScore = tie.scoreA != null || tie.scoreB != null;
  const hasPen  = tie.scoreAPenalties != null && tie.scoreBPenalties != null;
  const hasLegs = (tie.legs?.length ?? 0) >= 2;

  // Partido único + legsPerTie=2 y solo hay leg1 → mostrar indicador "vuelta pendiente"
  const hasOnlyLeg1 = !hasLegs && (tie.legs?.length ?? 0) === 1 && legsPerTie === 2;

  // LIVE: cualquier pierna activa, o partido único en ventana
  const live = tie.legs
    ? tie.legs.some((l) => isLive(l.utcDate))
    : isLive(tie.utcDate);

  // Para partido único: la tarjeta entera es clickeable
  const handleSingleLegClick = () => {
    if (!onSelectTeam) return;
    const teamId = tie.slotA.participantId;
    if (!teamId) return;
    if (activeFocusTeamId === teamId) {
      onSelectTeam(teamId); // toggle off
    } else {
      const dateLocal = tie.utcDate ? toLocalDate(tie.utcDate) : undefined;
      onSelectTeam(teamId, dateLocal);
    }
  };

  const isSingleLegClickable = !hasLegs && !!onSelectTeam && !!tie.slotA.participantId;

  return (
    <div
      style={{
        backgroundColor: 'var(--sp-surface-card)',
        border: live
          ? '1.5px solid rgba(239,68,68,0.55)'
          : `1px solid ${expanded ? 'var(--sp-border-12)' : 'var(--sp-border-8)'}`,
        borderRadius: 10,
        overflow: 'hidden',
        cursor: isSingleLegClickable ? 'pointer' : 'default',
        transition: 'border-color 0.12s',
        position: 'relative',
      }}
      onClick={isSingleLegClickable ? handleSingleLegClick : undefined}
      onMouseEnter={(e) => {
        if (isSingleLegClickable)
          (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--sp-primary-40)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = live
          ? 'rgba(239,68,68,0.55)'
          : expanded ? 'var(--sp-border-12)' : 'var(--sp-border-8)';
      }}
    >
      {/* Dot LIVE */}
      {live && (
        <span style={{
          position: 'absolute', top: 6, right: 8,
          width: 6, height: 6, borderRadius: '50%',
          background: 'var(--sp-status-error)',
          animation: 'sp-badge-blink 2s ease-in-out infinite',
        }} />
      )}

      {/* Nombre del cruce */}
      <div style={{
        padding: '4px 10px 0',
        fontSize: 9, fontWeight: 700,
        color: 'var(--sp-text-25)',
        textTransform: 'uppercase', letterSpacing: '0.07em',
      }}>
        {tie.name}
      </div>

      {/* SlotA */}
      <SlotRow
        name={tie.slotA.teamName ?? tie.slotA.placeholderText ?? 'Por def.'}
        crestUrl={tie.slotA.crestUrl}
        score={hasScore ? tie.scoreA : undefined}
        pen={hasPen ? tie.scoreAPenalties : null}
        isWinner={winA}
        live={live}
        isMobile={isMobile}
      />

      {/* Divisor */}
      <div style={{ borderTop: '1px solid var(--sp-border-6)', margin: '0 10px' }} />

      {/* SlotB */}
      <SlotRow
        name={tie.slotB.teamName ?? tie.slotB.placeholderText ?? 'Por def.'}
        crestUrl={tie.slotB.crestUrl}
        score={hasScore ? tie.scoreB : undefined}
        pen={hasPen ? tie.scoreBPenalties : null}
        isWinner={winB}
        live={live}
        isMobile={isMobile}
      />

      {/* Footer: toggle ida/vuelta */}
      {(hasLegs || hasOnlyLeg1) && (
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            padding: '4px 0',
            borderTop: '1px solid var(--sp-border-5)',
            backgroundColor: expanded ? 'var(--sp-border-6)' : 'var(--sp-border-4)',
            cursor: 'pointer',
          }}
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
        >
          <span style={{ fontSize: 9, color: 'var(--sp-text-35)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {expanded ? 'Ocultar' : 'Ida · Vuelta'}
          </span>
          <span style={{ fontSize: 9, color: 'var(--sp-text-30)' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      )}

      {/* Piernas expandidas */}
      {(hasLegs || hasOnlyLeg1) && expanded && (
        <LegsExpanded
          tie={tie}
          legsPerTie={legsPerTie}
          onSelectTeam={onSelectTeam}
        />
      )}
    </div>
  );
}

// ── LegsExpanded ──────────────────────────────────────────────────────────────

function LegsExpanded({
  tie,
  legsPerTie,
  onSelectTeam,
}: {
  tie: TieDTO;
  legsPerTie: 1 | 2;
  onSelectTeam?: (teamId: string, dateLocal?: string) => void;
}) {
  const legs = tie.legs ?? [];
  const leg1 = legs[0] as LegDTO | undefined;
  const leg2 = legs[1] as LegDTO | undefined;

  const slotA = { name: tie.slotA.teamName, crest: tie.slotA.crestUrl, id: tie.slotA.participantId };
  const slotB = { name: tie.slotB.teamName, crest: tie.slotB.crestUrl, id: tie.slotB.participantId };

  const makeSelectLeg = (teamId: string | null | undefined, utcDate: string | undefined) => {
    if (!onSelectTeam || !teamId || !utcDate) return undefined;
    return () => onSelectTeam(teamId, toLocalDate(utcDate));
  };

  return (
    <div style={{
      borderTop: '1px dashed var(--sp-border-8)',
      padding: '4px 6px 6px',
      display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      {/* Leg 1: slotA local */}
      {leg1 ? (
        <LegRow
          label="Ida"
          utcDate={leg1.utcDate}
          homeTeam={slotA}
          awayTeam={slotB}
          homeScore={leg1.scoreA}
          awayScore={leg1.scoreB}
          onSelect={makeSelectLeg(slotA.id, leg1.utcDate)}
        />
      ) : null}

      {/* Leg 2: slotB local */}
      {leg2 ? (
        <LegRow
          label="Vuelta"
          utcDate={leg2.utcDate}
          homeTeam={slotB}
          awayTeam={slotA}
          homeScore={leg2.scoreB}
          awayScore={leg2.scoreA}
          homePen={leg2.penB ?? null}
          awayPen={leg2.penA ?? null}
          onSelect={makeSelectLeg(slotB.id, leg2.utcDate)}
        />
      ) : legsPerTie === 2 ? (
        /* leg2 aún no publicado por el API */
        <div style={{ padding: '6px 10px' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--sp-text-25)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Vuelta · Por confirmar
          </span>
        </div>
      ) : null}
    </div>
  );
}
