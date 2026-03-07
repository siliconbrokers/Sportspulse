import { useState } from 'react';
import type { MatchCardDTO, UrgencyColorKey, HeatBorderKey } from '../types/snapshot.js';
import { useWindowWidth } from '../hooks/use-window-width.js';
import { computeLiveTimeChip } from '../utils/time-chip.js';
import './match-map.css';

interface MatchMapCardGridProps {
  matchCards: MatchCardDTO[];
  focusedTeamId: string | null;
  onSelectTeam: (teamId: string) => void;
  showForm?: boolean;
}

// ─── Urgency key recalculado en cliente con Date.now() ────────────────────────

function computeLiveUrgencyKey(status: string | undefined, kickoffUtc: string | undefined): UrgencyColorKey {
  if (status === 'LIVE') return 'LIVE';
  if (status === 'FINISHED') return 'UNKNOWN';
  if (!kickoffUtc) return 'UNKNOWN';
  const hours = (new Date(kickoffUtc).getTime() - Date.now()) / (1000 * 60 * 60);
  if (hours < 0) return 'UNKNOWN';
  if (hours < 24) return 'TODAY';
  if (hours < 48) return 'TOMORROW';
  if (hours < 96) return 'D2_3';
  if (hours <= 168) return 'D4_7';
  return 'LATER';
}

// ─── Urgency → background color (§5) ─────────────────────────────────────────

const URGENCY_BG: Record<UrgencyColorKey, string> = {
  LIVE:     'linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%)',
  TODAY:    'linear-gradient(135deg, #7c2d12 0%, #92400e 100%)',
  TOMORROW: 'linear-gradient(135deg, #0e4d6e 0%, #0e6d9e 100%)',
  D2_3:     'linear-gradient(135deg, #365314 0%, #3f6212 100%)',
  D4_7:     'linear-gradient(135deg, #14532d 0%, #166534 100%)',
  LATER:    'linear-gradient(135deg, #1e3a5f 0%, #1e40af 100%)',
  UNKNOWN:  'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
};

const URGENCY_GLOW: Record<UrgencyColorKey, string> = {
  LIVE:     'rgba(239,68,68,0.5)',
  TODAY:    'rgba(249,115,22,0.4)',
  TOMORROW: 'rgba(56,189,248,0.35)',
  D2_3:     'rgba(163,230,53,0.28)',
  D4_7:     'rgba(74,222,128,0.25)',
  LATER:    'rgba(96,165,250,0.22)',
  UNKNOWN:  'rgba(148,163,184,0.18)',
};

// ─── Heat border CSS class (§6) ───────────────────────────────────────────────

function heatClass(key: HeatBorderKey): string {
  switch (key) {
    case 'BOTH_HOT':     return 'mm-tile--heat-both_hot';
    case 'ONE_HOT':      return 'mm-tile--heat-one_hot';
    case 'DATA_MISSING': return 'mm-tile--heat-data_missing';
    default:             return '';
  }
}

// ─── Tile content ─────────────────────────────────────────────────────────────

function CrestImg({ url, name, size }: { url?: string; name: string; size: number }) {
  const [err, setErr] = useState(false);
  if (url && !err) {
    return (
      <img
        src={url}
        alt={name}
        onError={() => setErr(true)}
        style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        backgroundColor: 'rgba(255,255,255,0.12)',
        flexShrink: 0,
      }}
    />
  );
}

function formColor(kind?: string): string {
  switch (kind) {
    case 'FORM_HOT':  return 'rgba(251,146,60,0.95)';  // naranja
    case 'FORM_GOOD': return 'rgba(74,222,128,0.90)';  // verde
    case 'FORM_BAD':  return 'rgba(248,113,113,0.90)'; // rojo
    default:          return 'rgba(255,255,255,0.40)';
  }
}

function isEffectivelyLive(card: MatchCardDTO): boolean {
  if (card.status === 'LIVE') return true;
  if (card.status === 'SCHEDULED' && card.kickoffUtc) {
    const mins = (Date.now() - new Date(card.kickoffUtc).getTime()) / 60000;
    return mins >= 0 && mins <= 110;
  }
  return false;
}

function TileContent({ card, crestSize, showForm }: { card: MatchCardDTO; crestSize: number; showForm: boolean }) {
  const homeName = card.home.name || '—';
  const awayName = card.away.name || '—';
  const nameSize = crestSize <= 28 ? 10 : 11;
  const scoreSize = crestSize <= 28 ? 15 : 18;
  const pad = crestSize <= 28 ? '8px 10px' : '10px 12px';

  const homeForm = showForm ? card.home.formChip : undefined;
  const awayForm = showForm ? card.away.formChip : undefined;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: pad,
        boxSizing: 'border-box',
        gap: 3,
      }}
    >
      {/* Nombres */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
        <span
          style={{
            fontSize: nameSize,
            fontWeight: 700,
            color: 'rgba(255,255,255,0.95)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
        >
          {homeName}
        </span>
        <span
          style={{
            fontSize: nameSize,
            fontWeight: 700,
            color: 'rgba(255,255,255,0.95)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
            textAlign: 'right',
          }}
        >
          {awayName}
        </span>
      </div>

      {/* Escudos + marcador */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <CrestImg url={card.home.crestUrl} name={homeName} size={crestSize} />
        <span
          style={{
            fontSize: scoreSize,
            fontWeight: 800,
            color: '#fff',
            letterSpacing: '-0.5px',
            minWidth: 28,
            textAlign: 'center',
          }}
        >
          {(card.status === 'FINISHED' || isEffectivelyLive(card)) && card.scoreHome != null && card.scoreAway != null
            ? `${card.scoreHome}-${card.scoreAway}`
            : 'vs'}
        </span>
        <CrestImg url={card.away.crestUrl} name={awayName} size={crestSize} />
      </div>

      {/* Forma de cada equipo */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            color: formColor(homeForm?.kind),
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '45%',
          }}
        >
          {homeForm ? `${homeForm.icon} ${homeForm.label}` : '—'}
        </span>
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            color: formColor(awayForm?.kind),
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '45%',
            textAlign: 'right',
          }}
        >
          {awayForm ? `${awayForm.icon} ${awayForm.label}` : '—'}
        </span>
      </div>

      {/* Tiempo — calculado en cliente para no depender del cache del backend */}
      {(() => {
        const tc = computeLiveTimeChip(card.status, card.kickoffUtc);
        return (
          <div
            style={{
              fontSize: 10,
              color: 'rgba(255,255,255,0.65)',
              textAlign: 'center',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {tc.icon} {tc.label}
          </div>
        );
      })()}
    </div>
  );
}

// ─── MatchMapCardGrid ─────────────────────────────────────────────────────────

export function MatchMapCardGrid({
  matchCards,
  focusedTeamId,
  onSelectTeam,
  showForm = false,
}: MatchMapCardGridProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';

  if (matchCards.length === 0) {
    return (
      <div
        style={{
          color: 'rgba(255,255,255,0.4)',
          textAlign: 'center',
          padding: '48px 16px',
          fontSize: 14,
        }}
      >
        No hay partidos en esta jornada
      </div>
    );
  }

  const hasSelection = focusedTeamId !== null;

  // Dimensiones base del tile: mismo ancho para todos, altura uniforme
  const tileW = isMobile ? 160 : 200;
  const tileH = isMobile ? 120 : 150;
  const crestSize = isMobile ? 26 : 32;

  return (
    <div
      className={hasSelection ? 'mm-grid mm-grid--has-selection' : 'mm-grid'}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: isMobile ? 8 : 12,
        padding: isMobile ? '10px' : '16px 24px',
        justifyContent: 'center',
        alignItems: 'flex-start',
      }}
    >
      {matchCards.map((card) => {
        const hints = card.tileHints;
        const urgencyKey = computeLiveUrgencyKey(card.status, card.kickoffUtc);
        const heatKey = hints?.heatBorderKey ?? 'NONE';
        const isFeatured = hints?.featuredRank === 'FEATURED';

        const isCardSelected =
          focusedTeamId === card.home.teamId || focusedTeamId === card.away.teamId;

        const glowColor = URGENCY_GLOW[urgencyKey];

        const tileClasses = [
          'mm-tile',
          urgencyKey === 'TODAY' ? 'mm-tile--today' : '',
          heatClass(heatKey),
          isFeatured ? 'mm-tile--featured' : '',
          isCardSelected ? 'mm-tile--selected' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <div
            key={card.matchId}
            className={tileClasses}
            tabIndex={0}
            aria-label={`${card.home.name} vs ${card.away.name}`}
            onMouseEnter={() => setHoveredId(card.matchId)}
            onMouseLeave={() => setHoveredId(null)}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const teamId =
                e.clientX - rect.left < rect.width / 2
                  ? card.home.teamId
                  : card.away.teamId;
              onSelectTeam(teamId);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectTeam(card.home.teamId);
              }
            }}
            style={{
              width: tileW,
              height: tileH,
              background: URGENCY_BG[urgencyKey],
              ['--mm-glow-color' as string]: glowColor,
              ['--mm-shadow-base' as string]: '0 2px 8px rgba(0,0,0,0.4)',
            }}
          >
            {isFeatured && heatKey === 'BOTH_HOT' && (
              <span className="mm-tile__badge" aria-hidden="true">🔥</span>
            )}
            <TileContent card={card} crestSize={crestSize} showForm={showForm} />
          </div>
        );
      })}
    </div>
  );
}
