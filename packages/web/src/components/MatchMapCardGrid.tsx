import { useState } from 'react';
import type { MatchCardDTO, UrgencyColorKey, HeatBorderKey, SizeBucket } from '../types/snapshot.js';
import {
  MatchMapCard,
  type MatchFormLabel,
  type MatchMapCardScore,
  type MatchMapCardKickoff,
} from './MatchMapCard.js';
import { useWindowWidth } from '../hooks/use-window-width.js';
import './match-map.css';

interface MatchMapCardGridProps {
  matchCards: MatchCardDTO[];
  focusedTeamId: string | null;
  onSelectTeam: (teamId: string) => void;
}

// ─── Urgency → background color (§5) ─────────────────────────────────────────

const URGENCY_BG: Record<UrgencyColorKey, string> = {
  LIVE:     '#7f1d1d',  // red-900
  TODAY:    '#7c2d12',  // orange-900
  TOMORROW: '#78350f',  // amber-900
  D2_3:     '#365314',  // lime-900
  D4_7:     '#14532d',  // green-900
  LATER:    '#1e3a5f',  // blue-steel
  UNKNOWN:  '#1e293b',  // slate-800
};

const URGENCY_ACCENT: Record<UrgencyColorKey, string> = {
  LIVE:     'rgba(239,68,68,0.55)',
  TODAY:    'rgba(249,115,22,0.45)',
  TOMORROW: 'rgba(245,158,11,0.40)',
  D2_3:     'rgba(163,230,53,0.30)',
  D4_7:     'rgba(74,222,128,0.25)',
  LATER:    'rgba(96,165,250,0.25)',
  UNKNOWN:  'rgba(148,163,184,0.20)',
};

// ─── Size → pixel dimensions (§4) ────────────────────────────────────────────

function sizeToPixels(bucket: SizeBucket, isMobile: boolean): { w: number; h: number } {
  if (isMobile) {
    switch (bucket) {
      case 'XL': return { w: 300, h: 200 };
      case 'L':  return { w: 260, h: 170 };
      case 'M':  return { w: 220, h: 145 };
      case 'S':  return { w: 200, h: 130 };
    }
  }
  switch (bucket) {
    case 'XL': return { w: 320, h: 210 };
    case 'L':  return { w: 272, h: 178 };
    case 'M':  return { w: 240, h: 158 };
    case 'S':  return { w: 210, h: 138 };
  }
}

// ─── Heat border CSS class (§6) ───────────────────────────────────────────────

function heatClass(key: HeatBorderKey): string {
  switch (key) {
    case 'BOTH_HOT':     return 'mm-tile--heat-both_hot';
    case 'ONE_HOT':      return 'mm-tile--heat-one_hot';
    case 'DATA_MISSING': return 'mm-tile--heat-data_missing';
    default:             return '';
  }
}

// ─── Mappers MatchCardDTO → MatchMapCardProps ─────────────────────────────────

function toFormLabel(card: MatchCardDTO): MatchFormLabel {
  const homeKind = card.home.formChip?.kind;
  const awayKind = card.away.formChip?.kind;
  if (homeKind === 'FORM_HOT' || awayKind === 'FORM_HOT') return 'VIENE_PICANTE';
  if (homeKind === 'FORM_GOOD' || awayKind === 'FORM_GOOD') return 'VIENE_BIEN';
  return 'NORMAL';
}

function toScore(card: MatchCardDTO): MatchMapCardScore | null {
  if (card.status === 'FINISHED' && card.scoreHome != null && card.scoreAway != null) {
    return { home: card.scoreHome, away: card.scoreAway };
  }
  return null;
}

function toKickoff(card: MatchCardDTO): MatchMapCardKickoff | null {
  if (!card.kickoffUtc) return null;
  return {
    utc: card.kickoffUtc,
    relativeLabel: card.timeChip.label,
  };
}

function toInterestPercent(card: MatchCardDTO): number {
  return Math.round((card.rankScore ?? 0) * 100);
}

// ─── MatchMapCardGrid ─────────────────────────────────────────────────────────

export function MatchMapCardGrid({
  matchCards,
  focusedTeamId,
  onSelectTeam,
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

  return (
    <div
      className={hasSelection ? 'mm-grid mm-grid--has-selection' : 'mm-grid'}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: isMobile ? 10 : 14,
        padding: isMobile ? '12px' : '16px 24px',
        justifyContent: 'center',
        alignItems: 'flex-start',
      }}
    >
      {matchCards.map((card) => {
        const hints = card.tileHints;
        const sizeBucket = hints?.sizeBucket ?? 'M';
        const urgencyKey = hints?.urgencyColorKey ?? 'UNKNOWN';
        const heatKey = hints?.heatBorderKey ?? 'NONE';
        const isFeatured = hints?.featuredRank === 'FEATURED';

        const isCardSelected =
          focusedTeamId === card.home.teamId || focusedTeamId === card.away.teamId;

        const { w, h } = sizeToPixels(sizeBucket, isMobile);
        const bgColor = URGENCY_BG[urgencyKey];
        const glowColor = URGENCY_ACCENT[urgencyKey];

        const tileClasses = [
          'mm-tile',
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
              width: w,
              height: h,
              backgroundColor: bgColor,
              // CSS custom properties for animations
              ['--mm-glow-color' as string]: glowColor,
              ['--mm-shadow-base' as string]: '0 2px 8px rgba(0,0,0,0.35)',
            }}
          >
            {isFeatured && heatKey === 'BOTH_HOT' && (
              <span className="mm-tile__badge" aria-hidden="true">🔥</span>
            )}
            <MatchMapCard
              matchId={card.matchId}
              homeTeam={{
                id: card.home.teamId,
                name: card.home.name,
                crestUrl: card.home.crestUrl,
              }}
              awayTeam={{
                id: card.away.teamId,
                name: card.away.name,
                crestUrl: card.away.crestUrl,
              }}
              score={toScore(card)}
              formLabel={toFormLabel(card)}
              kickoff={toKickoff(card)}
              interestPercent={toInterestPercent(card)}
              isSelected={isCardSelected}
              isLoading={false}
            />
          </div>
        );
      })}
    </div>
  );
}
