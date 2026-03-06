import { useState } from 'react';
import { useWindowWidth } from '../hooks/use-window-width.js';

// ─── Types (§ 4.1) ────────────────────────────────────────────────────────────

export type MatchFormLabel = 'VIENE_BIEN' | 'VIENE_PICANTE' | 'NORMAL';

export type MatchMapCardTeam = {
  id: string;
  name: string;
  shortName?: string;
  crestUrl?: string | null;
};

export type MatchMapCardScore = {
  home: number | null;
  away: number | null;
  display?: string;
};

export type MatchMapCardKickoff = {
  utc: string;
  relativeLabel?: string;
};

export type MatchMapCardProps = {
  matchId: string;
  homeTeam: MatchMapCardTeam;
  awayTeam: MatchMapCardTeam;
  score?: MatchMapCardScore | null;
  formLabel?: MatchFormLabel | null;
  kickoff?: MatchMapCardKickoff | null;
  interestPercent?: number | null;
  onClick?: () => void;
  isSelected?: boolean;
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
  testId?: string;
};

// ─── Helpers (§ 6) ────────────────────────────────────────────────────────────

const FORM_LABEL_TEXT: Record<MatchFormLabel, string> = {
  VIENE_BIEN: 'Viene bien',
  VIENE_PICANTE: 'Viene picante',
  NORMAL: 'Normal',
};

export function resolveScoreDisplay(score?: MatchMapCardScore | null): string {
  if (score?.display && score.display.trim()) return score.display.trim();
  if (typeof score?.home === 'number' && typeof score?.away === 'number') {
    return `${score.home} - ${score.away}`;
  }
  return 'vs';
}

export function resolveInterestDisplay(value?: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—%';
  const normalized = Math.max(0, Math.min(100, Math.round(value)));
  return `${normalized}%`;
}

// ─── CrestImage (§ 6.2, § 10.1, § 15.3) ──────────────────────────────────────

function CrestImage({
  crestUrl,
  teamName,
  size,
  testId,
}: {
  crestUrl?: string | null;
  teamName: string;
  size: number;
  testId: string;
}) {
  const [imgError, setImgError] = useState(false);

  return (
    <div
      data-testid={testId}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {crestUrl && !imgError ? (
        <img
          src={crestUrl}
          alt={teamName}
          onError={() => setImgError(true)}
          style={{ width: size, height: size, objectFit: 'contain' }}
        />
      ) : (
        <div
          aria-hidden="true"
          style={{
            width: size,
            height: size,
            borderRadius: 6,
            backgroundColor: 'rgba(255,255,255,0.08)',
          }}
        />
      )}
    </div>
  );
}

// ─── Skeleton (§ 14.6) ────────────────────────────────────────────────────────

function Bone({
  w,
  h,
  rounded,
}: {
  w: number | string;
  h: number;
  rounded?: number;
}) {
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: rounded ?? 4,
        backgroundColor: 'rgba(255,255,255,0.1)',
        flexShrink: 0,
      }}
    />
  );
}

function LoadingSkeleton({ crestSize }: { crestSize: number }) {
  return (
    <>
      <header
        data-testid="match-map-card-header"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
      >
        <Bone w={70} h={10} />
        <Bone w={70} h={10} />
      </header>

      <div style={{ height: 10 }} />

      <section
        data-testid="match-map-card-crests"
        style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12 }}
      >
        <Bone w={crestSize} h={crestSize} rounded={6} />
        <Bone w={crestSize} h={crestSize} rounded={6} />
      </section>

      <div style={{ height: 8 }} />

      <section
        data-testid="match-map-card-score"
        style={{ display: 'flex', justifyContent: 'center' }}
      >
        <Bone w={56} h={20} />
      </section>

      <div style={{ height: 4 }} />

      <section
        data-testid="match-map-card-status"
        style={{ display: 'flex', justifyContent: 'center' }}
      >
        <Bone w={80} h={10} />
      </section>

      <div style={{ height: 10 }} />

      <footer
        data-testid="match-map-card-footer"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <Bone w={80} h={9} />
        <Bone w={30} h={11} />
      </footer>
    </>
  );
}

// ─── MatchMapCard (§ 3, § 7, § 8, § 9, § 10, § 14, § 16) ────────────────────

export function MatchMapCard({
  matchId,
  homeTeam,
  awayTeam,
  score,
  formLabel,
  kickoff,
  interestPercent,
  onClick,
  isSelected = false,
  isLoading = false,
  disabled = false,
  className,
  testId,
}: MatchMapCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const { breakpoint } = useWindowWidth();
  const isCompact = breakpoint === 'mobile';

  // ── Content resolution (§ 24 pseudocode) ────────────────────────────────────
  const homeName = homeTeam.shortName?.trim() || homeTeam.name?.trim() || '—';
  const awayName = awayTeam.shortName?.trim() || awayTeam.name?.trim() || '—';

  const scoreDisplay = resolveScoreDisplay(score);

  const safeFormLabel: MatchFormLabel =
    formLabel === 'VIENE_BIEN' || formLabel === 'VIENE_PICANTE' || formLabel === 'NORMAL'
      ? formLabel
      : 'NORMAL';
  const statusText = FORM_LABEL_TEXT[safeFormLabel];

  const kickoffLabel = kickoff?.relativeLabel?.trim() || 'Próximamente';
  const interestDisplay = resolveInterestDisplay(interestPercent);

  // ── Accessibility label (§ 16.3) ────────────────────────────────────────────
  const ariaLabel = `Partido ${homeName} contra ${awayName}. Score ${scoreDisplay}. Estado ${statusText}. ${kickoffLabel}. Interés ${interestDisplay}.`;

  // ── Dimensions (§ 8, § 13) ──────────────────────────────────────────────────
  const cardWidth = isCompact ? 220 : 248;
  const minHeight = isCompact ? 148 : 156;
  const paddingInline = isCompact ? 10 : 12;
  const paddingBlock = isCompact ? 8 : 10;
  const crestSize = isCompact ? 32 : 36;
  const scoreFontSize = isCompact ? 18 : 20;
  const scoreLineHeight = isCompact ? '22px' : '24px';
  const nameFontSize = isCompact ? 11 : 12;
  const nameLineHeight = isCompact ? '14px' : '16px';

  // ── Interactive state ────────────────────────────────────────────────────────
  const isClickable = !!onClick && !disabled;
  const showHoverEffect = isClickable && isHovered && !isSelected;

  // ── Visual tokens (§ 12) ────────────────────────────────────────────────────
  const borderColor = isSelected
    ? 'rgba(99,102,241,0.85)'
    : showHoverEffect
    ? 'rgba(255,255,255,0.22)'
    : 'rgba(255,255,255,0.09)';

  const bgColor = isSelected
    ? 'rgba(99,102,241,0.09)'
    : showHoverEffect
    ? 'rgba(255,255,255,0.09)'
    : 'rgba(255,255,255,0.05)';

  const boxShadow =
    isSelected || showHoverEffect
      ? '0 4px 16px rgba(0,0,0,0.12)'
      : '0 2px 10px rgba(0,0,0,0.08)';

  const focusOutline =
    isFocused && isClickable ? '2px solid rgba(99,102,241,0.85)' : 'none';

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isClickable) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick?.();
    }
  };

  return (
    <article
      data-testid={testId ?? 'match-map-card'}
      data-match-id={matchId}
      data-selected={isSelected ? 'true' : 'false'}
      data-loading={isLoading ? 'true' : 'false'}
      data-disabled={disabled ? 'true' : 'false'}
      aria-label={ariaLabel}
      aria-selected={isSelected}
      aria-disabled={disabled || undefined}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={isClickable ? onClick : undefined}
      onKeyDown={isClickable ? handleKeyDown : undefined}
      onMouseEnter={isClickable ? () => setIsHovered(true) : undefined}
      onMouseLeave={
        isClickable
          ? () => {
              setIsHovered(false);
            }
          : undefined
      }
      onFocus={isClickable ? () => setIsFocused(true) : undefined}
      onBlur={isClickable ? () => setIsFocused(false) : undefined}
      className={className}
      style={{
        boxSizing: 'border-box',
        width: cardWidth,
        maxWidth: cardWidth,
        minHeight,
        paddingLeft: paddingInline,
        paddingRight: paddingInline,
        paddingTop: paddingBlock,
        paddingBottom: paddingBlock,
        borderRadius: 14,
        border: `1px solid ${borderColor}`,
        boxShadow,
        backgroundColor: bgColor,
        outline: focusOutline,
        outlineOffset: 2,
        display: 'flex',
        flexDirection: 'column',
        cursor: isClickable ? 'pointer' : disabled ? 'not-allowed' : 'default',
        opacity: disabled ? 0.5 : 1,
        transition: 'background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
        fontFamily: 'inherit',
      }}
    >
      {isLoading ? (
        <LoadingSkeleton crestSize={crestSize} />
      ) : (
        <>
          {/* ── 1. Header row (§ 7.2) ─────────────────────────────────────── */}
          <header
            data-testid="match-map-card-header"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <div
              data-testid="match-map-card-home-name"
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: nameFontSize,
                lineHeight: nameLineHeight,
                fontWeight: 600,
                color: 'rgba(255,255,255,0.95)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {homeName}
            </div>
            <div
              data-testid="match-map-card-away-name"
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: nameFontSize,
                lineHeight: nameLineHeight,
                fontWeight: 600,
                color: 'rgba(255,255,255,0.95)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                textAlign: 'right',
              }}
            >
              {awayName}
            </div>
          </header>

          {/* Spacing Header → Crests: 10px (§ 9) */}
          <div style={{ height: 10, flexShrink: 0 }} />

          {/* ── 2. Crest row (§ 7.3) — away LEFT, home RIGHT (§ 3.6, 3.7) ─ */}
          <section
            data-testid="match-map-card-crests"
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <CrestImage
              crestUrl={awayTeam.crestUrl}
              teamName={awayName}
              size={crestSize}
              testId="match-map-card-away-crest"
            />
            <CrestImage
              crestUrl={homeTeam.crestUrl}
              teamName={homeName}
              size={crestSize}
              testId="match-map-card-home-crest"
            />
          </section>

          {/* Spacing Crests → Score: 8px (§ 9) */}
          <div style={{ height: 8, flexShrink: 0 }} />

          {/* ── 3. Score row (§ 7.4, § 10.2) ─────────────────────────────── */}
          <section
            data-testid="match-map-card-score"
            style={{
              textAlign: 'center',
              fontSize: scoreFontSize,
              lineHeight: scoreLineHeight,
              fontWeight: 700,
              color: 'rgba(255,255,255,0.95)',
              whiteSpace: 'nowrap',
            }}
          >
            {scoreDisplay}
          </section>

          {/* Spacing Score → Status: 4px (§ 9) */}
          <div style={{ height: 4, flexShrink: 0 }} />

          {/* ── 4. Status row (§ 7.5, § 10.3) ────────────────────────────── */}
          <section
            data-testid="match-map-card-status"
            style={{
              textAlign: 'center',
              fontSize: 12,
              lineHeight: '16px',
              fontWeight: 500,
              color: 'rgba(255,255,255,0.50)',
              whiteSpace: 'nowrap',
            }}
          >
            {statusText}
          </section>

          {/* Spacing Status → Footer: 10px (§ 9) */}
          <div style={{ height: 10, flexShrink: 0 }} />

          {/* ── 5. Footer row (§ 7.6, § 10.4) ────────────────────────────── */}
          <footer
            data-testid="match-map-card-footer"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 'auto',
            }}
          >
            <div
              data-testid="match-map-card-kickoff"
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 11,
                lineHeight: '14px',
                fontWeight: 500,
                color: 'rgba(255,255,255,0.38)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {kickoffLabel}
            </div>
            <div
              data-testid="match-map-card-interest"
              style={{
                flexShrink: 0,
                marginLeft: 8,
                fontSize: 12,
                lineHeight: '16px',
                fontWeight: 700,
                color: 'rgba(255,255,255,0.95)',
                whiteSpace: 'nowrap',
              }}
            >
              {interestDisplay}
            </div>
          </footer>
        </>
      )}
    </article>
  );
}
