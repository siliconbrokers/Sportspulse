/**
 * PreliminaryRoundsView — vista de fases previas / clasificatorias.
 *
 * Diseño correcto para rondas que NO terminan en una Final sino en
 * clasificación a Fase de Grupos (Copa Libertadores, Sudamericana, etc.).
 *
 * Desktop: columnas secuenciales izq → der (una por ronda), con flechas
 *   entre rondas y badge "→ Grupos" al final.
 * Mobile: acordeón por ronda.
 *
 * Difiere de KnockoutBracket en que NO divide los cruces en mitad
 * izquierda / mitad derecha ni coloca una Final en el centro.
 */
import { useState } from 'react';
import { useWindowWidth } from '../hooks/use-window-width.js';
import type { LegDTO, RoundDTO, TieDTO, TieSlotDTO } from '../types/tournament.js';

/** Formatea una fecha ISO como "28 ene" — sin año, sin hora. */
function fmtLegDate(utcDate: string): string {
  try {
    return new Date(utcDate).toLocaleDateString('es-UY', {
      day: 'numeric', month: 'short', timeZone: 'America/Montevideo',
    });
  } catch {
    return '';
  }
}

/**
 * Devuelve las 3 primeras iniciales de las palabras significativas del nombre
 * (descarta artículos y preposiciones de 1-2 letras excepto números).
 * Ej: "Club The Strongest" → "CTS", "Deportivo Táchira FC" → "DTF"
 */
function toTLA(name: string): string {
  return name
    .split(/\s+/)
    .filter(w => w.length >= 2 || /^\d/.test(w))
    .map(w => w[0].toUpperCase())
    .join('')
    .slice(0, 3);
}

interface PreliminaryRoundsViewProps {
  rounds: RoundDTO[];
  /** teamId + dateLocal opcional (para piernas de ida/vuelta). Sin dateLocal → usa fecha de hoy. */
  onSelectTeam?: (teamId: string, dateLocal?: string) => void;
}

// ── Slot ─────────────────────────────────────────────────────────────────────

function PrelimSlot({ slot, isWinner, compact = false }: { slot: TieSlotDTO; isWinner: boolean; compact?: boolean }) {
  const hasTeam        = slot.participantId != null && slot.teamName;
  const hasPlaceholder = !hasTeam && slot.placeholderText;
  const displayName    = hasTeam
    ? (compact ? toTLA(slot.teamName!) : slot.teamName)
    : hasPlaceholder ? slot.placeholderText : 'Por def.';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '3px 6px',
      backgroundColor: isWinner ? 'rgba(34,197,94,0.1)' : 'var(--sp-border-4)',
      borderRadius: 4, minWidth: 0,
    }}>
      {hasTeam && slot.crestUrl ? (
        <img src={slot.crestUrl} alt={slot.teamName ?? ''} style={{ width: 15, height: 15, objectFit: 'contain', flexShrink: 0 }} />
      ) : (
        <div style={{ width: 15, height: 15, borderRadius: '50%', backgroundColor: 'var(--sp-border-8)', flexShrink: 0 }} />
      )}
      <span style={{
        fontSize: compact ? 12 : 11,
        fontWeight: isWinner ? 700 : 400,
        color: hasTeam ? (isWinner ? '#22c55e' : 'var(--sp-text-85)') : 'var(--sp-text-30)',
        fontStyle: hasTeam ? 'normal' : 'italic',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
      }}>
        {displayName}
      </span>
    </div>
  );
}

// ── LegsSection ───────────────────────────────────────────────────────────────
// Muestra cada partido (ida / vuelta) como mini-ficha con local y visitante.
//
// Convención de roles por pierna:
//   Leg 1: slotA = LOCAL  → homeScore=scoreA, awayScore=scoreB
//   Leg 2: slotB = LOCAL  → homeScore=scoreB, awayScore=scoreA
//            penales (si los hay): homePen=penB, awayPen=penA
//
// Así el usuario ve exactamente "quién jugó de local y qué marcó" en cada partido.

interface LegTeam {
  id?: string | null;
  name?: string;
  crest?: string;
}

function LegTeamRow({ team, score, pen }: { team: LegTeam; score: number | null; pen?: number | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {team.crest
        ? <img src={team.crest} alt="" style={{ width: 12, height: 12, objectFit: 'contain', flexShrink: 0 }} />
        : <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--sp-border-8)', flexShrink: 0 }} />
      }
      <span style={{ fontSize: 10, color: 'var(--sp-text-60)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {team.name ?? '?'}
      </span>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--sp-text-75)', fontVariantNumeric: 'tabular-nums', flexShrink: 0, minWidth: 12, textAlign: 'right' }}>
        {score ?? '–'}
      </span>
      {pen != null && (
        <span style={{ fontSize: 9, color: 'var(--sp-text-40)', flexShrink: 0 }}>({pen}p)</span>
      )}
    </div>
  );
}

function LegsSection({
  legs, slotA, slotB, onSelectLeg,
}: {
  legs: LegDTO[];
  slotA: LegTeam;
  slotB: LegTeam;
  onSelectLeg?: (teamId: string, dateLocal: string) => void;
}) {
  const leg1 = legs[0]; // slotA local
  const leg2 = legs[1]; // slotB local
  const hasPen = leg2.penA != null && leg2.penB != null;

  const legDate = (utcDate: string) => {
    try {
      return new Date(utcDate).toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' });
    } catch {
      return utcDate.slice(0, 10);
    }
  };

  const legBlock = (
    label: string,
    utcDate: string,
    homeTeam: LegTeam,
    awayTeam: LegTeam,
    homeScore: number | null,
    awayScore: number | null,
    homePen: number | null | undefined,
    awayPen: number | null | undefined,
    teamIdForDetail: string | null | undefined,
  ) => {
    const clickable = !!onSelectLeg && !!teamIdForDetail;
    return (
      <div
        style={{
          display: 'flex', flexDirection: 'column', gap: 2,
          cursor: clickable ? 'pointer' : 'default',
          padding: '3px 4px',
          borderRadius: 4,
          ...(clickable ? { ':hover': { backgroundColor: 'var(--sp-border-6)' } } : {}),
        }}
        onClick={(e) => {
          if (!clickable) return;
          e.stopPropagation();
          onSelectLeg!(teamIdForDetail!, legDate(utcDate));
        }}
      >
        <span style={{ fontSize: 9, fontWeight: 700, color: clickable ? 'var(--sp-primary)' : 'var(--sp-text-30)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label} · {fmtLegDate(utcDate)}
        </span>
        <LegTeamRow team={homeTeam} score={homeScore} pen={homePen ?? null} />
        <LegTeamRow team={awayTeam} score={awayScore} pen={awayPen ?? null} />
      </div>
    );
  };

  return (
    <div style={{ borderTop: '1px dashed var(--sp-border-8)', padding: '4px 2px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Ida: slotA local */}
      {legBlock('Ida', leg1.utcDate, slotA, slotB, leg1.scoreA, leg1.scoreB, null, null, slotA.id)}
      {/* Vuelta: slotB local, penales en leg2 si los hubo */}
      {legBlock('Vuelta', leg2.utcDate, slotB, slotA, leg2.scoreB, leg2.scoreA, hasPen ? leg2.penB : null, hasPen ? leg2.penA : null, slotB.id)}
    </div>
  );
}

// ── TieCard ───────────────────────────────────────────────────────────────────

const CARD_W = 164;
const CARD_H = 64;

function PrelimTieCard({ tie, onSelectTeam }: { tie: TieDTO; onSelectTeam?: (teamId: string, dateLocal?: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const winA     = tie.winnerId != null && tie.winnerId === tie.slotA.participantId;
  const winB     = tie.winnerId != null && tie.winnerId === tie.slotB.participantId;
  const hasScore = tie.scoreA != null || tie.scoreB != null;
  const hasPen   = tie.scoreAPenalties != null && tie.scoreBPenalties != null;
  const hasLegs  = (tie.legs?.length ?? 0) >= 2;

  // Las filas de equipo del agregado NO abren el DetailPanel —
  // el único punto de entrada es hacer click en una pierna (Ida / Vuelta) expandida.
  const teamRow = (slot: TieDTO['slotA'], isWinner: boolean, score?: number | null, pen?: number | null) => (
    <div style={{ height: CARD_H / 2, display: 'flex', alignItems: 'center', gap: 3, padding: '0 3px', minWidth: 0 }}>
      <div style={{ flex: 1, minWidth: 0 }}><PrelimSlot slot={slot} isWinner={isWinner} /></div>
      {hasScore && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, minWidth: 22 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: isWinner ? '#22c55e' : 'var(--sp-text-55)', lineHeight: 1 }}>
            {score ?? '–'}
          </span>
          {hasPen && pen != null && (
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--sp-text-40)', lineHeight: 1, marginTop: 1 }}>
              ({pen})
            </span>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div
      style={{
        width: CARD_W,
        backgroundColor: 'var(--sp-surface-card)',
        border: `1px solid ${expanded ? 'var(--sp-border-12)' : 'var(--sp-border-8)'}`,
        borderRadius: 6, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        cursor: hasLegs ? 'pointer' : 'default',
      }}
      onClick={() => hasLegs && setExpanded(v => !v)}
    >
      {teamRow(tie.slotA, winA, tie.scoreA, tie.scoreAPenalties)}
      <div style={{ borderTop: '1px solid var(--sp-border-6)', margin: '0 4px' }} />
      {teamRow(tie.slotB, winB, tie.scoreB, tie.scoreBPenalties)}

      {/* Indicador expandible */}
      {hasLegs && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '2px 0', gap: 3,
          borderTop: '1px solid var(--sp-border-5)',
          backgroundColor: expanded ? 'var(--sp-border-6)' : 'var(--sp-border-4)',
        }}>
          <span style={{ fontSize: 8, color: 'var(--sp-text-35)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {expanded ? 'Ocultar' : 'Ida · Vuelta'}
          </span>
          <span style={{ fontSize: 8, color: 'var(--sp-text-30)' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      )}

      {/* Detalle piernas — cada una clickeable para abrir el DetailPanel del partido */}
      {hasLegs && expanded && (
        <LegsSection
          legs={tie.legs!}
          slotA={{ id: tie.slotA.participantId, name: tie.slotA.teamName, crest: tie.slotA.crestUrl }}
          slotB={{ id: tie.slotB.participantId, name: tie.slotB.teamName, crest: tie.slotB.crestUrl }}
          onSelectLeg={onSelectTeam}
        />
      )}
    </div>
  );
}

// ── Columna de una ronda ──────────────────────────────────────────────────────

const ROW_GAP = 10;

function RoundColumn({ round, onSelectTeam }: { round: RoundDTO; onSelectTeam?: (teamId: string, dateLocal?: string) => void }) {
  const ties = [...round.ties].sort((a, b) => a.orderIndex - b.orderIndex);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
      {/* Cabecera de ronda */}
      <div style={{
        fontSize: 10, fontWeight: 700,
        color: 'var(--sp-text-40)',
        textTransform: 'uppercase', letterSpacing: '0.07em',
        marginBottom: 10, textAlign: 'center', width: CARD_W,
      }}>
        {round.name}
      </div>

      {/* Lista vertical de llaves */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: ROW_GAP }}>
        {ties.map(tie => (
          <PrelimTieCard key={tie.tieId} tie={tie} onSelectTeam={onSelectTeam} />
        ))}
      </div>
    </div>
  );
}

// ── Separador entre rondas ────────────────────────────────────────────────────

function RoundSeparator() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', alignSelf: 'center',
      color: 'var(--sp-text-25)', fontSize: 20, padding: '0 6px',
      marginTop: 24, // alinear con la primera llave (compensar cabecera)
    }}>
      →
    </div>
  );
}

// ── Badge "→ Fase de Grupos" ──────────────────────────────────────────────────

function GroupsBadge() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      alignSelf: 'center', gap: 4, paddingLeft: 4, marginTop: 24,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: 'var(--sp-text-40)',
        textTransform: 'uppercase', letterSpacing: '0.07em',
        textAlign: 'center',
      }}>
        Clasifica a
      </div>
      <div style={{
        fontSize: 11, fontWeight: 700,
        color: 'var(--sp-primary)',
        padding: '4px 10px',
        border: '1px solid var(--sp-primary)',
        borderRadius: 12,
        whiteSpace: 'nowrap',
      }}>
        Fase de Grupos
      </div>
    </div>
  );
}

// ── Desktop: scroll horizontal con rondas en columnas ───────────────────────

function DesktopPreliminary({ rounds, onSelectTeam }: { rounds: RoundDTO[]; onSelectTeam?: (teamId: string, dateLocal?: string) => void }) {
  const sorted = [...rounds].sort((a, b) => a.orderIndex - b.orderIndex);

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, width: 'fit-content' }}>
        {sorted.map((round, idx) => (
          <div key={round.stageId} style={{ display: 'flex', alignItems: 'flex-start' }}>
            {idx > 0 && <RoundSeparator />}
            <RoundColumn round={round} onSelectTeam={onSelectTeam} />
          </div>
        ))}
        {sorted.length > 0 && <RoundSeparator />}
        {sorted.length > 0 && <GroupsBadge />}
      </div>
    </div>
  );
}

// ── Mobile: acordeón por ronda ────────────────────────────────────────────────

function MobilePreliminaryTieCard({ tie, onSelectTeam }: { tie: TieDTO; onSelectTeam?: (teamId: string, dateLocal?: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const winA     = tie.winnerId != null && tie.winnerId === tie.slotA.participantId;
  const winB     = tie.winnerId != null && tie.winnerId === tie.slotB.participantId;
  const hasScore = tie.scoreA != null || tie.scoreB != null;
  const hasPen   = tie.scoreAPenalties != null && tie.scoreBPenalties != null;
  const hasLegs  = (tie.legs?.length ?? 0) >= 2;

  // Las filas del agregado NO abren DetailPanel — solo las piernas expandidas lo hacen.
  const mobileTeamRow = (slot: TieDTO['slotA'], isWinner: boolean, score?: number | null, pen?: number | null) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 44 }}>
      {/* compact=true → TLA de 3 letras en lugar del nombre completo */}
      <div style={{ flex: 1, minWidth: 0 }}><PrelimSlot slot={slot} isWinner={isWinner} compact /></div>
      {hasScore && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, minWidth: 26 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: isWinner ? '#22c55e' : 'var(--sp-text-70)', lineHeight: 1 }}>
            {score ?? '–'}
          </span>
          {hasPen && pen != null && (
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--sp-text-40)', lineHeight: 1, marginTop: 1 }}>
              ({pen})
            </span>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div
      style={{
        backgroundColor: 'var(--sp-surface-card)',
        border: '1px solid var(--sp-border-8)',
        borderRadius: 8, overflow: 'hidden', marginBottom: 6,
        cursor: hasLegs ? 'pointer' : 'default',
      }}
      onClick={() => hasLegs && setExpanded(v => !v)}
    >
      {/* Cabecera con nombre del cruce + indicador expandible */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '3px 8px', borderBottom: '1px solid var(--sp-border-5)',
      }}>
        <span style={{ fontSize: 10, color: 'var(--sp-text-30)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {tie.name}
        </span>
        {hasLegs && (
          <span style={{ fontSize: 10, color: 'var(--sp-text-30)' }}>{expanded ? '▲' : '▼'}</span>
        )}
      </div>

      {/* Filas de equipos — solo muestran resultado agregado, no abren panel */}
      <div style={{ padding: '5px 6px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {mobileTeamRow(tie.slotA, winA, tie.scoreA, tie.scoreAPenalties)}
        {mobileTeamRow(tie.slotB, winB, tie.scoreB, tie.scoreBPenalties)}
      </div>

      {/* Detalle piernas (expandible) — cada pierna abre DetailPanel al hacer click */}
      {hasLegs && expanded && (
        <LegsSection
          legs={tie.legs!}
          slotA={{ id: tie.slotA.participantId, name: tie.slotA.teamName, crest: tie.slotA.crestUrl }}
          slotB={{ id: tie.slotB.participantId, name: tie.slotB.teamName, crest: tie.slotB.crestUrl }}
          onSelectLeg={onSelectTeam}
        />
      )}
    </div>
  );
}

function MobilePreliminary({ rounds, onSelectTeam }: { rounds: RoundDTO[]; onSelectTeam?: (teamId: string, dateLocal?: string) => void }) {
  const sorted = [...rounds].sort((a, b) => a.orderIndex - b.orderIndex);
  // Abre por defecto la ronda más reciente con cruces
  const defaultOpen = [...sorted]
    .filter(r => r.ties.length > 0)
    .sort((a, b) => b.orderIndex - a.orderIndex)[0]?.stageId ?? sorted[0]?.stageId;
  const [openId, setOpenId] = useState<string | null>(defaultOpen ?? null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {sorted.map((round) => {
        const isOpen = openId === round.stageId;
        const ties   = [...round.ties].sort((a, b) => a.orderIndex - b.orderIndex);
        return (
          <div key={round.stageId} style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--sp-border-8)' }}>
            <button
              onClick={() => setOpenId(isOpen ? null : round.stageId)}
              aria-expanded={isOpen}
              style={{
                width: '100%',
                background: isOpen ? 'var(--sp-border-8)' : 'var(--sp-border-4)',
                border: 'none', color: 'var(--sp-text)',
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', padding: '10px 14px', cursor: 'pointer',
                fontSize: 12, fontWeight: 600, textAlign: 'left', minHeight: 44,
              }}
            >
              <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--sp-text-70)' }}>
                {round.name}
              </span>
              <span style={{ color: 'var(--sp-text-40)', fontSize: 16 }}>{isOpen ? '▲' : '▼'}</span>
            </button>
            {isOpen && (
              <div style={{ padding: '8px 8px 12px' }}>
                {ties.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--sp-text-35)', textAlign: 'center', padding: '8px 0' }}>
                    Sin cruces disponibles
                  </div>
                ) : (
                  ties.map(tie => <MobilePreliminaryTieCard key={tie.tieId} tie={tie} onSelectTeam={onSelectTeam} />)
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Indicador final: clasifica a grupos */}
      {sorted.length > 0 && (
        <div style={{
          marginTop: 8, padding: '8px 12px',
          backgroundColor: 'var(--sp-border-4)', borderRadius: 8,
          fontSize: 12, color: 'var(--sp-text-50)', textAlign: 'center',
        }}>
          Los ganadores de la última ronda clasifican a la{' '}
          <strong style={{ color: 'var(--sp-primary)' }}>Fase de Grupos</strong>
        </div>
      )}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export function PreliminaryRoundsView({ rounds, onSelectTeam }: PreliminaryRoundsViewProps) {
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';

  if (rounds.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--sp-text-40)', textAlign: 'center', padding: '24px 0' }}>
        Sin fase previa disponible.
      </div>
    );
  }

  return isMobile
    ? <MobilePreliminary rounds={rounds} onSelectTeam={onSelectTeam} />
    : <DesktopPreliminary rounds={rounds} onSelectTeam={onSelectTeam} />;
}
