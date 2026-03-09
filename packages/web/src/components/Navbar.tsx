/**
 * Navbar — Premium Dark Glassmorphism
 * Tokens: bg-brand-dark/80, border-brand-primary, text-brand-primary, rounded-bento-inner
 */
import { useState } from 'react';
import { Search, X, Sun, Moon } from 'lucide-react';
import { useWindowWidth } from '../hooks/use-window-width.js';
import { useTheme } from '../hooks/use-theme.js';
import { competitionDisplayName } from '../utils/labels.js';

export type ViewMode = 'home' | 'radar' | 'partidos' | 'standings';

const NAV_ITEMS: { id: ViewMode; icon: string; label: string; shortLabel: string }[] = [
  { id: 'home',      icon: '🏠', label: 'Inicio',   shortLabel: 'Inicio'   },
  { id: 'radar',     icon: '🛰',  label: 'Radar',    shortLabel: 'Radar'    },
  { id: 'partidos',  icon: '⚽',  label: 'Partidos', shortLabel: 'Partidos' },
  { id: 'standings', icon: '📊', label: 'Tabla',    shortLabel: 'Tabla'    },
];

interface Competition {
  id: string;
  isTournament: boolean;
}

interface NavbarProps {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  competitionId: string;
  onCompetitionChange: (id: string) => void;
  matchday: number | null;
  onMatchdayChange: (md: number) => void;
  competitions: Competition[];
  totalMatchdays: number;
  currentMatchday: number | null | undefined;
  compInfoLoading: boolean;
}

export function Navbar({
  view,
  onViewChange,
  competitionId,
  onCompetitionChange,
  matchday,
  onMatchdayChange,
  competitions,
  totalMatchdays,
  currentMatchday,
  compInfoLoading,
}: NavbarProps) {
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';
  const isLeagueView = view !== 'home';
  const [searchOpen, setSearchOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  const matchdayOptions = Array.from({ length: totalMatchdays }, (_, i) => i + 1);

  return (
    // Contenedor sticky glassmorphism
    <header
      className="sticky top-0 z-50 backdrop-blur-md"
      style={{
        background: 'var(--sp-header)',
        borderBottom: '1px solid var(--sp-border-5)',
        transition: 'background 0.2s ease',
      }}
    >
      {/* ── Fila principal ─────────────────────────────────────────────── */}
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: isMobile ? '10px 14px 10px' : '10px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: isMobile ? 8 : 16,
        }}
      >
        {/* ── Logo ──────────────────────────────────────────────────────── */}
        <button
          onClick={() => onViewChange('home')}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
            minHeight: 44,
          }}
          aria-label="SportsPulse — Inicio"
        >
          {/* Logo imagen */}
          <img
            src="/logo.png"
            alt=""
            style={{ height: isMobile ? 28 : 36, width: 'auto' }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
          {/* Wordmark — visible solo en desktop */}
          {!isMobile && (
            <span
              style={{
                fontWeight: 900,
                letterSpacing: '-0.05em',
                fontSize: 17,
                color: '#fff',
                lineHeight: 1,
                fontFamily: 'inherit',
              }}
            >
              SPORTS
              <span style={{ color: '#00E0FF' }}>PULSE</span>
            </span>
          )}
        </button>

        {/* ── Pill Nav (centro) ──────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          {/* Pill container — fully rounded */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              padding: '4px 6px',
              background: 'var(--sp-surface)',
              borderRadius: '9999px',
              border: '1px solid var(--sp-border-8)',
              transition: 'background 0.2s ease',
            }}
          >
            {NAV_ITEMS.map((item) => {
              const isActive = view === item.id;
              return (
                <NavTab
                  key={item.id}
                  icon={item.icon}
                  label={isMobile ? item.shortLabel : item.label}
                  isActive={isActive}
                  isMobile={isMobile}
                  onClick={() => onViewChange(item.id)}
                />
              );
            })}
          </div>
        </div>

        {/* ── Zona derecha: search + selects desktop ────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {/* Toggle Day/Night */}
          <ThemeToggle theme={theme} onToggle={toggleTheme} />

          {/* Barra de búsqueda expandible */}
          <SearchBar open={searchOpen} onToggle={() => setSearchOpen((p) => !p)} isMobile={isMobile} />

          {/* Selects de liga/jornada en desktop (fila inline) */}
          {isLeagueView && !isMobile && (
            <div style={{ display: 'flex', gap: 6 }}>
              <LeagueSelect
                value={competitionId}
                onChange={onCompetitionChange}
                options={competitions}
                isMobile={false}
              />
              <MatchdaySelect
                value={matchday}
                onChange={onMatchdayChange}
                options={matchdayOptions}
                currentMatchday={currentMatchday}
                loading={compInfoLoading}
                isMobile={false}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Segunda fila mobile: selects de liga/jornada ──────────────── */}
      {isLeagueView && isMobile && (
        <div
          style={{
            maxWidth: 1200,
            margin: '0 auto',
            padding: '0 14px 10px',
            display: 'flex',
            gap: 8,
          }}
        >
          <LeagueSelect
            value={competitionId}
            onChange={onCompetitionChange}
            options={competitions}
            isMobile={true}
          />
          <MatchdaySelect
            value={matchday}
            onChange={onMatchdayChange}
            options={matchdayOptions}
            currentMatchday={currentMatchday}
            loading={compInfoLoading}
            isMobile={true}
          />
        </div>
      )}
    </header>
  );
}

// ─── ThemeToggle ─────────────────────────────────────────────────────────────
function ThemeToggle({ theme, onToggle }: { theme: 'dark' | 'light'; onToggle: () => void }) {
  const isLight = theme === 'light';
  return (
    <button
      onClick={onToggle}
      title={isLight ? 'Cambiar a modo noche' : 'Cambiar a modo día'}
      style={{
        width: 34,
        height: 34,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: isLight ? 'rgba(2,132,199,0.1)' : 'rgba(255,255,255,0.05)',
        border: isLight
          ? '1px solid rgba(2,132,199,0.35)'
          : '1px solid rgba(255,255,255,0.1)',
        cursor: 'pointer',
        color: isLight ? '#0284C7' : '#8A94A8',
        transition: 'all 0.15s ease',
        flexShrink: 0,
      }}
    >
      {isLight ? <Moon size={14} strokeWidth={2.5} /> : <Sun size={14} strokeWidth={2.5} />}
    </button>
  );
}

// ─── NavTab ──────────────────────────────────────────────────────────────────
function NavTab({
  icon,
  label,
  isActive,
  isMobile,
  onClick,
}: {
  icon: string;
  label: string;
  isActive: boolean;
  isMobile: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: isMobile ? 0 : 6,
        padding: isMobile ? '6px 12px' : '7px 16px',
        borderRadius: '9999px',            // rounded-full — píldora
        border: isActive
          ? '1px solid var(--sp-primary-40)'
          : '1px solid transparent',
        background: isActive
          ? 'var(--sp-primary-10)'
          : hovered
            ? 'var(--sp-border-8)'
            : 'transparent',
        color: isActive ? 'var(--sp-primary)' : hovered ? 'var(--sp-text)' : 'var(--sp-secondary)',
        fontSize: isMobile ? 13 : 12,
        fontWeight: isActive ? 700 : 500,
        cursor: 'pointer',
        letterSpacing: isActive ? '0.01em' : '0',
        transition: 'all 0.15s ease',
        textShadow: isActive ? '0 0 14px var(--sp-primary-40)' : 'none',
        boxShadow: isActive
          ? '0 0 10px var(--sp-primary-10) inset'
          : 'none',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontSize: isMobile ? 15 : 13, lineHeight: 1 }}>{icon}</span>
      {!isMobile && <span>{label}</span>}
    </button>
  );
}

// ─── SearchBar ────────────────────────────────────────────────────────────────
function SearchBar({
  open,
  onToggle,
  isMobile,
}: {
  open: boolean;
  onToggle: () => void;
  isMobile: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {open && !isMobile && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'var(--sp-surface)',
            border: '1px solid var(--sp-primary-22)',
            borderRadius: '0.75rem',
            padding: '5px 10px',
            animation: 'fadeIn 0.15s ease',
          }}
        >
          <Search size={13} color="var(--sp-primary)" strokeWidth={2.5} />
          <input
            autoFocus
            placeholder="Buscar equipo..."
            style={{
              background: 'none',
              border: 'none',
              outline: 'none',
              color: 'var(--sp-text)',
              fontSize: 12,
              width: 140,
              caretColor: 'var(--sp-primary)',
            }}
            onKeyDown={(e) => e.key === 'Escape' && onToggle()}
          />
        </div>
      )}
      <button
        onClick={onToggle}
        title={open ? 'Cerrar búsqueda' : 'Buscar'}
        style={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: open ? 'var(--sp-primary-10)' : 'var(--sp-border)',
          border: open ? '1px solid var(--sp-primary-40)' : '1px solid var(--sp-border-8)',
          cursor: 'pointer',
          color: open ? 'var(--sp-primary)' : 'var(--sp-secondary)',
          transition: 'all 0.15s ease',
          flexShrink: 0,
        }}
      >
        {open ? <X size={14} strokeWidth={2.5} /> : <Search size={14} strokeWidth={2.5} />}
      </button>
    </div>
  );
}

// ─── LeagueSelect ─────────────────────────────────────────────────────────────
function LeagueSelect({
  value,
  onChange,
  options,
  isMobile,
}: {
  value: string;
  onChange: (id: string) => void;
  options: Competition[];
  isMobile: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={selectStyle(isMobile)}
    >
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          {competitionDisplayName(c.id)}
        </option>
      ))}
    </select>
  );
}

// ─── MatchdaySelect ──────────────────────────────────────────────────────────
function MatchdaySelect({
  value,
  onChange,
  options,
  currentMatchday,
  loading,
  isMobile,
}: {
  value: number | null;
  onChange: (md: number) => void;
  options: number[];
  currentMatchday: number | null | undefined;
  loading: boolean;
  isMobile: boolean;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(Number(e.target.value))}
      disabled={loading}
      style={{ ...selectStyle(isMobile), opacity: loading ? 0.5 : 1 }}
    >
      {loading ? (
        <option value="">Cargando...</option>
      ) : (
        options.map((md) => (
          <option key={md} value={md}>
            J{md}{md === currentMatchday ? ' ✓' : ''}
          </option>
        ))
      )}
    </select>
  );
}

// ─── Estilos compartidos ──────────────────────────────────────────────────────
function selectStyle(isMobile: boolean): React.CSSProperties {
  return {
    background: 'var(--sp-surface)',
    color: 'var(--sp-text)',
    border: '1px solid var(--sp-border-8)',
    borderRadius: '0.5rem',
    padding: isMobile ? '5px 6px' : '6px 10px',
    fontSize: isMobile ? 11 : 12,
    cursor: 'pointer',
    outline: 'none',
    appearance: 'none',
    WebkitAppearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%238A94A8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 8px center',
    paddingRight: 24,
    transition: 'background 0.2s ease',
  };
}
