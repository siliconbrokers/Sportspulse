/**
 * LeagueSelector — selector de liga Premium
 * Desktop: dropdown con backdrop-blur
 * Mobile: bottom sheet con overlay
 */
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import { useWindowWidth } from '../hooks/use-window-width.js';
import { COMPETITION_META, getCompMeta } from '../utils/competition-meta.js';

interface LeagueSelectorProps {
  value: string;
  onChange: (id: string) => void;
  /** Solo mostrar estas IDs (filtra torneos si es necesario) */
  options: { id: string; isTournament?: boolean }[];
}

// ─── Logo con fallback ────────────────────────────────────────────────────────
function LeagueLogo({ logoUrl, name, size }: { logoUrl: string; name: string; size: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        className="rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold"
        style={{
          width: size,
          height: size,
          background: 'var(--sp-border-8)',
          color: 'var(--sp-text-55)',
        }}
      >
        {name.slice(0, 2).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={logoUrl}
      alt={name}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{ objectFit: 'contain', flexShrink: 0 }}
    />
  );
}

// ─── Fila de opción en el menú ────────────────────────────────────────────────
function LeagueOption({
  meta,
  isSelected,
  onClick,
}: {
  meta: (typeof COMPETITION_META)[0];
  isSelected: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="w-full flex items-center gap-3 text-left transition-all"
      style={{
        minHeight: 52,
        padding: '10px 16px',
        background: isSelected
          ? `${meta.accent}15`
          : hovered
            ? 'var(--sp-border-5)'
            : 'transparent',
        border: 'none',
        borderLeft: isSelected ? `3px solid ${meta.accent}` : '3px solid transparent',
        cursor: 'pointer',
      }}
    >
      <LeagueLogo logoUrl={meta.logoUrl} name={meta.name} size={28} />
      <div className="flex-1 min-w-0">
        <div
          className="text-sm font-bold truncate"
          style={{ color: isSelected ? meta.accent : hovered ? 'var(--sp-text)' : 'var(--sp-text-88)' }}
        >
          {meta.name}
        </div>
        <div className="text-xs" style={{ color: 'var(--sp-text-35)' }}>
          Temporada {meta.season}
        </div>
      </div>
      {isSelected && (
        <div
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: meta.accent, boxShadow: `0 0 6px ${meta.accent}` }}
        />
      )}
    </button>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export function LeagueSelector({ value, onChange, options }: LeagueSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { breakpoint } = useWindowWidth();
  // Usar bottom sheet en mobile Y tablet — el dropdown desktop puede quedar
  // cortado por el stacking context de backdrop-filter en iOS Safari.
  const isMobile = breakpoint !== 'desktop';

  const selected = getCompMeta(value);

  // Filtrar por IDs disponibles
  const availableMeta = COMPETITION_META.filter((m) =>
    options.some((o) => o.id === m.id)
  );

  // Cerrar con Escape o click fuera (solo desktop)
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function handleClick(e: MouseEvent) {
      if (!isMobile && containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [open, isMobile]);

  // Bloquear scroll del body en mobile cuando está abierto
  useEffect(() => {
    if (isMobile) {
      document.body.style.overflow = open ? 'hidden' : '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open, isMobile]);

  function handleSelect(id: string) {
    onChange(id);
    setOpen(false);
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {/* ── Trigger ───────────────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-2 rounded-full transition-all"
        style={{
          padding: isMobile ? '6px 10px 6px 8px' : '7px 12px 7px 10px',
          minHeight: 44,
          background: open ? 'var(--sp-primary-10)' : 'var(--sp-border)',
          border: open
            ? '1px solid var(--sp-primary-40)'
            : '1px solid var(--sp-border-8)',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => {
          if (!open) (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--sp-primary-40)';
        }}
        onMouseLeave={(e) => {
          if (!open) (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--sp-border-8)';
        }}
      >
        {selected ? (
          <LeagueLogo logoUrl={selected.logoUrl} name={selected.name} size={22} />
        ) : (
          <div className="w-5 h-5 rounded-full" style={{ background: 'var(--sp-border-8)' }} />
        )}
        <span
          className="text-sm font-bold"
          style={{ color: open ? 'var(--sp-primary)' : 'var(--sp-text-88)', whiteSpace: 'nowrap' }}
        >
          {isMobile ? (selected?.shortName ?? 'Liga') : (selected?.name ?? 'Seleccionar liga')}
        </span>
        <ChevronDown
          size={14}
          strokeWidth={2.5}
          style={{
            color: open ? 'var(--sp-primary)' : 'var(--sp-text-35)',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s ease, color 0.15s ease',
            flexShrink: 0,
          }}
        />
      </button>

      {/* ── Dropdown (desktop) ────────────────────────────────────────────── */}
      {!isMobile && open && (
        <div
          className="absolute right-0 top-full mt-2 rounded-2xl overflow-hidden"
          style={{
            minWidth: 240,
            background: 'var(--sp-header)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid var(--sp-border-8)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,224,255,0.05)',
            zIndex: 100,
            animation: 'dropdownIn 0.15s ease',
          }}
        >
          <div
            className="px-4 py-3 text-xs font-bold uppercase tracking-widest"
            style={{
              color: 'var(--sp-text-35)',
              borderBottom: '1px solid var(--sp-border-5)',
            }}
          >
            Seleccionar Liga
          </div>
          {availableMeta.map((meta) => (
            <LeagueOption
              key={meta.id}
              meta={meta}
              isSelected={meta.id === value}
              onClick={() => handleSelect(meta.id)}
            />
          ))}
        </div>
      )}

      {/* ── Bottom sheet (mobile) — portal a document.body para escapar del
           stacking context del header (backdrop-filter en iOS Safari crea un
           nuevo containing block para position:fixed) ─────────────────────── */}
      {isMobile && open && createPortal(
        <>
          {/* Overlay */}
          <div
            onClick={() => setOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(4px)',
              zIndex: 9998,
              animation: 'fadeIn 0.2s ease',
            }}
          />
          {/* Panel */}
          <div
            style={{
              position: 'fixed',
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 9999,
              background: 'var(--sp-surface)',
              borderTop: '1px solid var(--sp-border-8)',
              borderRadius: '1.5rem 1.5rem 0 0',
              paddingBottom: 'env(safe-area-inset-bottom, 16px)',
              animation: 'slideUp 0.25s cubic-bezier(0.32,0.72,0,1)',
              boxShadow: '0 -20px 60px rgba(0,0,0,0.5)',
            }}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full" style={{ background: 'var(--sp-border-8)' }} />
            </div>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-sm font-bold uppercase tracking-widest" style={{ color: 'var(--sp-text-35)' }}>
                Seleccionar Liga
              </span>
              <button
                onClick={() => setOpen(false)}
                className="flex items-center justify-center rounded-full"
                style={{
                  width: 32,
                  height: 32,
                  background: 'var(--sp-border)',
                  border: '1px solid var(--sp-border-8)',
                  cursor: 'pointer',
                  color: 'var(--sp-text-55)',
                }}
              >
                <X size={14} strokeWidth={2.5} />
              </button>
            </div>
            {/* Opciones */}
            <div style={{ borderTop: '1px solid var(--sp-border-5)', overflowY: 'auto', maxHeight: '60vh' }}>
              {availableMeta.map((meta) => (
                <LeagueOption
                  key={meta.id}
                  meta={meta}
                  isSelected={meta.id === value}
                  onClick={() => handleSelect(meta.id)}
                />
              ))}
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
