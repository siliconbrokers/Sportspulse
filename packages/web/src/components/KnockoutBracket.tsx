/**
 * KnockoutBracket — bracket visual de copa simétrico.
 *
 * Desktop: árbol izq ──▶ Final ◀── der
 *   - Columnas desde el borde hacia el centro
 *   - Conectores CSS entre rondas consecutivas
 *   - Final centrado, Tercer puesto debajo
 *
 * Mobile: acordeón por ronda (collapse/expand).
 *
 * Genérico: funciona con cualquier profundidad de cuadro.
 */
import { useState, useRef, useLayoutEffect } from 'react';
import { useWindowWidth } from '../hooks/use-window-width.js';
import type { RoundDTO, TieDTO, TieSlotDTO } from '../types/tournament.js';

interface KnockoutBracketProps {
  rounds: RoundDTO[];
}

// ── Constantes de layout ──────────────────────────────────────────────────────

const CARD_H = 64;          // alto del TieCard
const UNIT_H = CARD_H + 6;  // alto por slot (card + gap mínimo)
const COL_W  = 152;         // ancho natural de cada columna de tie cards
const CONN_W = 18;          // ancho natural de zona de conectores
// Ancho natural (4 rondas KO): 9×152 + 8×18 = 1512px
// El componente escala con zoom para llenar el contenedor disponible

// ── Helpers de posición ───────────────────────────────────────────────────────

/** Alto de cada slot dentro de una columna. */
function slotHeight(tiesInCol: number, totalH: number): number {
  return totalH / tiesInCol;
}

/** Y superior del card dentro de su slot (centrado). */
function cardTopY(idx: number, tiesInCol: number, totalH: number): number {
  const sh = slotHeight(tiesInCol, totalH);
  return idx * sh + (sh - CARD_H) / 2;
}

/** Y del centro del card. */
function cardCenterY(idx: number, tiesInCol: number, totalH: number): number {
  return cardTopY(idx, tiesInCol, totalH) + CARD_H / 2;
}

// ── Categorización de rondas ──────────────────────────────────────────────────

interface CategorizedRounds {
  /** Rondas eliminatorias puras (excluye Final y 3er puesto), orden outer→inner. */
  knockout: RoundDTO[];
  final: RoundDTO | null;
  thirdPlace: RoundDTO | null;
}

function categorize(rounds: RoundDTO[]): CategorizedRounds {
  return {
    final:      rounds.find(r => r.stageType === 'FINAL') ?? null,
    thirdPlace: rounds.find(r => r.stageType === 'PLAYOFF') ?? null,
    knockout:   rounds
      .filter(r => r.stageType !== 'FINAL' && r.stageType !== 'PLAYOFF')
      .sort((a, b) => a.orderIndex - b.orderIndex),
  };
}

/** Divide los ties de una ronda en mitad izquierda y mitad derecha. */
function splitHalf(round: RoundDTO): { left: TieDTO[]; right: TieDTO[] } {
  const sorted = [...round.ties].sort((a, b) => a.orderIndex - b.orderIndex);
  const mid = Math.ceil(sorted.length / 2);
  return { left: sorted.slice(0, mid), right: sorted.slice(mid) };
}

// ── SlotDisplay (compacto para bracket) ──────────────────────────────────────

function BracketSlot({ slot, isWinner }: { slot: TieSlotDTO; isWinner: boolean }) {
  const hasTeam  = slot.participantId != null && slot.teamName;
  const hasPlaceholder = !hasTeam && slot.placeholderText;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '3px 6px',
      backgroundColor: isWinner ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.03)',
      borderRadius: 4, minWidth: 0,
    }}>
      {hasTeam && slot.crestUrl ? (
        <img src={slot.crestUrl} alt={slot.teamName ?? ''} style={{ width: 15, height: 15, objectFit: 'contain', flexShrink: 0 }} />
      ) : (
        <div style={{ width: 15, height: 15, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />
      )}
      <span style={{
        fontSize: 11,
        fontWeight: isWinner ? 700 : 400,
        color: hasTeam ? (isWinner ? '#22c55e' : 'rgba(255,255,255,0.85)') : 'rgba(255,255,255,0.28)',
        fontStyle: hasTeam ? 'normal' : 'italic',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
      }}>
        {hasTeam ? slot.teamName : hasPlaceholder ? slot.placeholderText : 'Por definir'}
      </span>
    </div>
  );
}

// ── TieCard compacto ──────────────────────────────────────────────────────────

function BracketTieCard({ tie }: { tie: TieDTO }) {
  const winA = tie.winnerId != null && tie.winnerId === tie.slotA.participantId;
  const winB = tie.winnerId != null && tie.winnerId === tie.slotB.participantId;
  const hasScore = tie.scoreA != null || tie.scoreB != null;

  return (
    <div style={{
      backgroundColor: 'rgba(255,255,255,0.05)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 6, overflow: 'hidden',
      height: CARD_H, display: 'flex', flexDirection: 'column',
    }}>
      {/* Slot A */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 3, padding: '0 3px', minWidth: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <BracketSlot slot={tie.slotA} isWinner={winA} />
        </div>
        {hasScore && (
          <span style={{ fontSize: 12, fontWeight: 700, minWidth: 18, textAlign: 'center', color: winA ? '#22c55e' : 'rgba(255,255,255,0.6)', flexShrink: 0 }}>
            {tie.scoreA ?? '–'}
          </span>
        )}
      </div>
      {/* Divider */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '0 4px' }} />
      {/* Slot B */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 3, padding: '0 3px', minWidth: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <BracketSlot slot={tie.slotB} isWinner={winB} />
        </div>
        {hasScore && (
          <span style={{ fontSize: 12, fontWeight: 700, minWidth: 18, textAlign: 'center', color: winB ? '#22c55e' : 'rgba(255,255,255,0.6)', flexShrink: 0 }}>
            {tie.scoreB ?? '–'}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Columna del bracket (un lado) ─────────────────────────────────────────────

interface ColProps {
  ties: TieDTO[];
  totalH: number;
  side: 'left' | 'right';
  /** Si es la columna más interna (SF), no dibuja conectores salientes. */
  innermost?: boolean;
}

function BracketColumn({ ties, totalH, side, innermost = false }: ColProps) {
  const n = ties.length;
  const isLeft = side === 'left';

  // Ancho total: el COL_W para el card + CONN_W para el conector (si aplica)
  const totalW = innermost ? COL_W : COL_W + CONN_W;

  return (
    <div style={{ position: 'relative', width: totalW, height: totalH, flexShrink: 0 }}>
      {/* Tie cards */}
      {ties.map((tie, idx) => (
        <div key={tie.tieId} style={{
          position: 'absolute',
          top: cardTopY(idx, n, totalH),
          // Lado derecho innermost: no hay brazo saliente → card arranca en 0 igual que el izquierdo
        left: isLeft || innermost ? 0 : CONN_W,
          width: COL_W,
        }}>
          <BracketTieCard tie={tie} />
        </div>
      ))}

      {/* Conectores (bracket shape) para cada par de ties */}
      {!innermost && Array.from({ length: Math.floor(n / 2) }, (_, k) => {
        const topC = cardCenterY(2 * k,     n, totalH);
        const botC = cardCenterY(2 * k + 1, n, totalH);
        const midY = (topC + botC) / 2;

        if (isLeft) {
          // ──┐         bracket shape a la derecha del card
          //   │ vertical
          // ──┘── arm saliente al centro
          return (
            <span key={k}>
              {/* Bracket bracket: top-arm + vertical-bar + bottom-arm */}
              <div style={{
                position: 'absolute',
                left: COL_W,
                top: topC,
                width: CONN_W / 2,
                height: botC - topC,
                borderTop: '1px solid rgba(255,255,255,0.18)',
                borderRight: '1px solid rgba(255,255,255,0.18)',
                borderBottom: '1px solid rgba(255,255,255,0.18)',
                boxSizing: 'border-box',
              }} />
              {/* Arm saliente desde el midpoint hacia la siguiente columna */}
              <div style={{
                position: 'absolute',
                left: COL_W + CONN_W / 2,
                top: midY,
                width: CONN_W / 2,
                height: 1,
                backgroundColor: 'rgba(255,255,255,0.18)',
              }} />
            </span>
          );
        } else {
          // arm ──┐         bracket shape a la izquierda del card
          //       │ vertical
          // ──────┘
          return (
            <span key={k}>
              {/* Bracket shape */}
              <div style={{
                position: 'absolute',
                left: CONN_W / 2,
                top: topC,
                width: CONN_W / 2,
                height: botC - topC,
                borderTop: '1px solid rgba(255,255,255,0.18)',
                borderLeft: '1px solid rgba(255,255,255,0.18)',
                borderBottom: '1px solid rgba(255,255,255,0.18)',
                boxSizing: 'border-box',
              }} />
              {/* Arm saliente desde el midpoint hacia el centro */}
              <div style={{
                position: 'absolute',
                left: 0,
                top: midY,
                width: CONN_W / 2,
                height: 1,
                backgroundColor: 'rgba(255,255,255,0.18)',
              }} />
            </span>
          );
        }
      })}
    </div>
  );
}

// ── Columna central: Final + 3er puesto ──────────────────────────────────────

function CenterColumn({
  final,
  thirdPlace,
  totalH,
}: {
  final: RoundDTO | null;
  thirdPlace: RoundDTO | null;
  totalH: number;
}) {
  const finalTop  = totalH / 2 - CARD_H / 2;
  const thirdTop  = totalH / 2 + CARD_H / 2 + 20;
  const colHeight = thirdPlace ? thirdTop + CARD_H + 8 : totalH;
  const finalTie  = final?.ties[0];
  const thirdTie  = thirdPlace?.ties[0];

  return (
    <div style={{ position: 'relative', width: CONN_W + COL_W + CONN_W, height: colHeight, flexShrink: 0 }}>
      {/* Arm entrante desde SF izquierdo */}
      <div style={{
        position: 'absolute', left: 0, top: totalH / 2,
        width: CONN_W, height: 1, backgroundColor: 'rgba(255,255,255,0.18)',
      }} />

      {/* Arm entrante desde SF derecho */}
      <div style={{
        position: 'absolute', right: 0, top: totalH / 2,
        width: CONN_W, height: 1, backgroundColor: 'rgba(255,255,255,0.18)',
      }} />

      {/* Label "Final" */}
      <div style={{
        position: 'absolute',
        top: finalTop - 18,
        left: CONN_W, width: COL_W,
        fontSize: 10, fontWeight: 700, textAlign: 'center',
        color: 'rgba(255,255,255,0.5)',
        textTransform: 'uppercase', letterSpacing: '0.07em',
      }}>
        Final
      </div>

      {/* Final card */}
      {finalTie && (
        <div style={{ position: 'absolute', top: finalTop, left: CONN_W, width: COL_W }}>
          <BracketTieCard tie={finalTie} />
        </div>
      )}

      {/* 3er puesto */}
      {thirdTie && (
        <>
          <div style={{
            position: 'absolute', top: thirdTop - 14, left: CONN_W, width: COL_W,
            fontSize: 9, fontWeight: 600, textAlign: 'center',
            color: 'rgba(255,255,255,0.3)',
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            3er puesto
          </div>
          <div style={{ position: 'absolute', top: thirdTop, left: CONN_W, width: COL_W }}>
            <BracketTieCard tie={thirdTie} />
          </div>
        </>
      )}
    </div>
  );
}

// ── Etiquetas de rondas ───────────────────────────────────────────────────────

function RoundLabel({ name, width }: { name: string; width: number }) {
  return (
    <div style={{
      width, flexShrink: 0, textAlign: 'center',
      fontSize: 10, fontWeight: 700,
      color: 'rgba(255,255,255,0.38)',
      textTransform: 'uppercase', letterSpacing: '0.07em',
      paddingBottom: 8,
    }}>
      {name}
    </div>
  );
}

// ── Vista de escritorio ───────────────────────────────────────────────────────

function DesktopBracket({ rounds }: { rounds: RoundDTO[] }) {
  const { knockout, final, thirdPlace } = categorize(rounds);

  if (knockout.length === 0 && !final) {
    return (
      <div style={{ fontSize: 13, opacity: 0.4, textAlign: 'center', padding: '24px 0' }}>
        Sin cuadro eliminatorio disponible.
      </div>
    );
  }

  // Ordenar del más poblado (externo) al menos (interno = SF)
  const koOuter2Inner = [...knockout].sort((a, b) => b.ties.length - a.ties.length);

  // totalH basado en la ronda más externa (más ties)
  const outerPerSide = koOuter2Inner.length > 0
    ? Math.ceil(koOuter2Inner[0].ties.length / 2)
    : 1;
  const totalH = Math.max(outerPerSide * UNIT_H, CARD_H + 32);

  // Halves para cada ronda
  const halves = koOuter2Inner.map(r => splitHalf(r));

  // Columnas izquierda (outer→inner) y derecha (inner→outer)
  const leftCols  = halves.map((h, i) => ({ ties: h.left,  innermost: i === halves.length - 1 }));
  const rightCols = [...halves].reverse().map((h, i) => ({ ties: h.right, innermost: i === 0 }));

  // Labels: left labels outer→inner, then center, then right labels inner→outer
  const leftLabels  = koOuter2Inner.map((r, i) => ({
    name:  r.name,
    width: i === koOuter2Inner.length - 1 ? COL_W : COL_W + CONN_W,
  }));
  const rightLabels = [...koOuter2Inner].reverse().map((r, i) => ({
    name:  r.name,
    width: i === 0 ? COL_W : CONN_W + COL_W,
  }));
  const centerW = CONN_W + COL_W + CONN_W;

  return (
    <div style={{ paddingBottom: 24 }}>
      {/* Etiquetas de rondas */}
      <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 0 }}>
        {leftLabels.map((l, i)  => <RoundLabel key={`ll-${i}`} name={l.name} width={l.width} />)}
        <RoundLabel name="" width={centerW} />
        {rightLabels.map((l, i) => <RoundLabel key={`rl-${i}`} name={l.name} width={l.width} />)}
      </div>

      {/* Bracket */}
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        {/* Lado izquierdo */}
        {leftCols.map((col, i) => (
          <BracketColumn
            key={`left-${i}`}
            ties={col.ties}
            totalH={totalH}
            side="left"
            innermost={col.innermost}
          />
        ))}

        {/* Centro: Final + 3er puesto */}
        <CenterColumn final={final} thirdPlace={thirdPlace} totalH={totalH} />

        {/* Lado derecho */}
        {rightCols.map((col, i) => (
          <BracketColumn
            key={`right-${i}`}
            ties={col.ties}
            totalH={totalH}
            side="right"
            innermost={col.innermost}
          />
        ))}
      </div>
    </div>
  );
}

// ── Vista mobile: acordeón ────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  ROUND_OF_32:    'Ronda de 32',
  ROUND_OF_16:    'Ronda de 16',
  QUARTER_FINALS: 'Cuartos de final',
  SEMI_FINALS:    'Semifinales',
  FINAL:          'Final',
  PLAYOFF:        'Tercer puesto',
  CUSTOM:         'Ronda',
  GROUP_STAGE:    'Fase de grupos',
  LEAGUE:         'Fase de liga',
};

function stageLabel(stageType: string, name: string): string {
  return STAGE_LABELS[stageType] ?? name;
}

function MobileTieCard({ tie }: { tie: TieDTO }) {
  const winA = tie.winnerId != null && tie.winnerId === tie.slotA.participantId;
  const winB = tie.winnerId != null && tie.winnerId === tie.slotB.participantId;
  const hasScore = tie.scoreA != null || tie.scoreB != null;

  return (
    <div style={{
      backgroundColor: 'rgba(255,255,255,0.05)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 8, overflow: 'hidden', marginBottom: 6,
    }}>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '3px 8px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        {tie.name}
      </div>
      <div style={{ padding: '5px 6px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ flex: 1, minWidth: 0 }}><BracketSlot slot={tie.slotA} isWinner={winA} /></div>
          {hasScore && <span style={{ fontSize: 13, fontWeight: 700, minWidth: 20, textAlign: 'center', color: winA ? '#22c55e' : 'rgba(255,255,255,0.7)' }}>{tie.scoreA ?? '–'}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ flex: 1, minWidth: 0 }}><BracketSlot slot={tie.slotB} isWinner={winB} /></div>
          {hasScore && <span style={{ fontSize: 13, fontWeight: 700, minWidth: 20, textAlign: 'center', color: winB ? '#22c55e' : 'rgba(255,255,255,0.7)' }}>{tie.scoreB ?? '–'}</span>}
        </div>
        {(tie.scoreAPenalties != null || tie.scoreBPenalties != null) && (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textAlign: 'right', marginTop: 2 }}>
            Pen. {tie.scoreAPenalties ?? '–'} – {tie.scoreBPenalties ?? '–'}
          </div>
        )}
      </div>
    </div>
  );
}

function MobileBracket({ rounds }: { rounds: RoundDTO[] }) {
  const sorted = [...rounds].sort((a, b) => a.orderIndex - b.orderIndex);
  const defaultOpen = [...sorted].filter(r => r.ties.length > 0).sort((a, b) => b.orderIndex - a.orderIndex)[0]?.stageId ?? sorted[0]?.stageId;
  const [openId, setOpenId] = useState<string | null>(defaultOpen ?? null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {sorted.map(round => {
        const isOpen = openId === round.stageId;
        const ties = [...round.ties].sort((a, b) => a.orderIndex - b.orderIndex);
        return (
          <div key={round.stageId} style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
            <button
              onClick={() => setOpenId(isOpen ? null : round.stageId)}
              style={{
                width: '100%', background: isOpen ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
                border: 'none', color: '#fff', display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', padding: '10px 14px', cursor: 'pointer',
                fontSize: 12, fontWeight: 600, textAlign: 'left', minHeight: 44,
              }}
            >
              <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.7 }}>
                {stageLabel(round.stageType, round.name)}
              </span>
              <span style={{ opacity: 0.4, fontSize: 16 }}>{isOpen ? '▲' : '▼'}</span>
            </button>
            {isOpen && (
              <div style={{ padding: '8px 8px 12px', display: 'flex', flexDirection: 'column' }}>
                {ties.length === 0 ? (
                  <div style={{ fontSize: 12, opacity: 0.35, textAlign: 'center', padding: '8px 0' }}>Sin cruces disponibles</div>
                ) : (
                  ties.map(tie => <MobileTieCard key={tie.tieId} tie={tie} />)
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export function KnockoutBracket({ rounds }: KnockoutBracketProps) {
  const { breakpoint } = useWindowWidth();
  const isCompact = breakpoint !== 'desktop';
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Calcula cuántas rondas KO hay para saber el ancho natural del bracket
  const { knockout } = categorize(rounds);
  const N = knockout.length;
  // Fórmula: (2N+1)×COL_W + 2N×CONN_W  (derivada de las columnas izq + centro + der)
  const naturalW = (2 * N + 1) * COL_W + 2 * N * CONN_W;

  // Escala el bracket para que llene exactamente el contenedor disponible
  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el || isCompact) return;
    const available = el.clientWidth;
    setScale(Math.min(1.3, Math.max(0.5, available / naturalW)));
  }, [rounds, naturalW, isCompact]);

  if (rounds.length === 0) {
    return (
      <div style={{ fontSize: 13, opacity: 0.4, textAlign: 'center', padding: '24px 0' }}>
        Sin fases eliminatorias disponibles.
      </div>
    );
  }

  if (isCompact) {
    return <MobileBracket rounds={rounds} />;
  }

  return (
    <div ref={outerRef} style={{ width: '100%', overflow: 'hidden' }}>
      {/* zoom escala el contenido Y su espacio en layout, sin scroll */}
      <div style={{ zoom: scale, width: 'fit-content' }}>
        <DesktopBracket rounds={rounds} />
      </div>
    </div>
  );
}
