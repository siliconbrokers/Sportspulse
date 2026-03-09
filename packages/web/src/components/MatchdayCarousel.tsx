/**
 * MatchdayCarousel — selector de jornada horizontal con flechas prev/next
 * Tokens: bg-brand-surface, brand-primary, rounded-bento-inner
 */
import { useEffect, useRef } from 'react';

interface MatchdayCarouselProps {
  totalMatchdays: number;
  selected: number | null;
  currentMatchday: number | null | undefined;
  onChange: (md: number) => void;
  isMobile: boolean;
}

function ArrowButton({
  direction,
  disabled,
  onClick,
}: {
  direction: 'prev' | 'next';
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flexShrink: 0,
        width: 36,
        height: 36,
        borderRadius: '0.75rem',
        border: '1px solid var(--sp-border-8)',
        background: 'var(--sp-surface-alpha)',
        color: disabled ? 'var(--sp-text-20)' : 'var(--sp-text-55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabled ? 'default' : 'pointer',
        fontSize: 14,
        transition: 'color 0.12s ease, border-color 0.12s ease, background 0.12s ease',
        zIndex: 3,
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--sp-primary)';
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--sp-primary-40)';
          (e.currentTarget as HTMLButtonElement).style.background = 'var(--sp-primary-04)';
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.color = disabled ? 'var(--sp-text-20)' : 'var(--sp-text-55)';
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--sp-border-8)';
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--sp-surface-alpha)';
      }}
    >
      {direction === 'prev' ? '‹' : '›'}
    </button>
  );
}

export function MatchdayCarousel({
  totalMatchdays,
  selected,
  currentMatchday,
  onChange,
  isMobile,
}: MatchdayCarouselProps) {
  const matchdays = Array.from({ length: totalMatchdays }, (_, i) => i + 1);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll al item activo al montar o cuando cambia
  useEffect(() => {
    if (!scrollRef.current || !selected) return;
    const container = scrollRef.current;
    const activeEl = container.querySelector<HTMLElement>('[data-active="true"]');
    if (!activeEl) return;
    const containerCenter = container.offsetWidth / 2;
    const itemCenter = activeEl.offsetLeft + activeEl.offsetWidth / 2;
    container.scrollLeft = itemCenter - containerCenter;
  }, [selected, totalMatchdays]);

  const canPrev = selected != null && selected > 1;
  const canNext = selected != null && selected < totalMatchdays;

  function handlePrev() {
    if (selected != null && selected > 1) onChange(selected - 1);
  }

  function handleNext() {
    if (selected != null && selected < totalMatchdays) onChange(selected + 1);
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: isMobile ? 16 : 20,
      }}
    >
      {/* Flecha anterior */}
      <ArrowButton direction="prev" disabled={!canPrev} onClick={handlePrev} />

      {/* Scroll container */}
      <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
        {/* Fade lateral izquierdo */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 24,
            background: 'linear-gradient(to right, var(--sp-bg), transparent)',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        />
        {/* Fade lateral derecho */}
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: 24,
            background: 'linear-gradient(to left, var(--sp-bg), transparent)',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        />

        <div
          ref={scrollRef}
          style={{
            display: 'flex',
            gap: isMobile ? 6 : 8,
            overflowX: 'auto',
            scrollbarWidth: 'none',
            WebkitOverflowScrolling: 'touch',
            padding: '4px 8px',
            scrollSnapType: 'x mandatory',
          }}
          className="[&::-webkit-scrollbar]:hidden"
        >
          {matchdays.map((md) => {
            const isActive = md === selected;
            const isCurrent = md === currentMatchday;

            return (
              <button
                key={md}
                data-active={isActive ? 'true' : 'false'}
                onClick={() => onChange(md)}
                style={{
                  flexShrink: 0,
                  scrollSnapAlign: 'center',
                  minWidth: isMobile ? 44 : 48,
                  minHeight: 36,
                  borderRadius: '0.75rem',
                  border: isActive
                    ? '1px solid var(--sp-primary-40)'
                    : isCurrent
                      ? '1px solid var(--sp-primary-22)'
                      : '1px solid var(--sp-border-8)',
                  background: isActive
                    ? 'var(--sp-primary-12)'
                    : isCurrent
                      ? 'var(--sp-primary-04)'
                      : 'var(--sp-surface-alpha)',
                  color: isActive || isCurrent
                    ? 'var(--sp-primary)'
                    : 'var(--sp-text-55)',
                  fontSize: isMobile ? 12 : 13,
                  fontWeight: isActive ? 800 : isCurrent ? 600 : 400,
                  cursor: 'pointer',
                  letterSpacing: isActive ? '0.01em' : '0',
                  textShadow: isActive ? '0 0 10px var(--sp-primary-40)' : 'none',
                  boxShadow: isActive ? '0 0 12px var(--sp-primary-10) inset' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.12s ease',
                  position: 'relative',
                }}
              >
                J{md}
                {/* Punto indicador de jornada actual */}
                {isCurrent && !isActive && (
                  <span
                    style={{
                      position: 'absolute',
                      bottom: 4,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: 4,
                      height: 4,
                      borderRadius: '50%',
                      background: 'var(--sp-primary-40)',
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Flecha siguiente */}
      <ArrowButton direction="next" disabled={!canNext} onClick={handleNext} />
    </div>
  );
}
