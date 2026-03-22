/**
 * Navbar — Ultra Pro Dark Glassmorphism
 * Lucide icons + floating glow pill (CSS spring) + live ping + mobile icon-only
 */
import { useState, useRef, useEffect, forwardRef } from 'react';
import {
  Home, Tv, CalendarDays, TrendingUp, Trophy,
  Sun, Moon, LogOut, LogIn,
} from 'lucide-react';
import { useWindowWidth } from '../hooks/use-window-width.js';
import { useTheme } from '../hooks/use-theme.js';
import { LeagueSelector } from './LeagueSelector.js';
import { useSession } from '../auth/SessionProvider.js';
import { apiClient } from '../api/client.js';

export type ViewMode = 'home' | 'tv' | 'partidos' | 'standings' | 'pronosticos';

const NAV_ITEMS: {
  id: ViewMode;
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
}[] = [
  { id: 'home',         Icon: Home,        label: 'Inicio'      },
  { id: 'tv',           Icon: Tv,          label: 'TV'          },
  { id: 'partidos',     Icon: CalendarDays, label: 'Partidos'   },
  { id: 'standings',    Icon: Trophy,      label: 'Tabla'       },
  { id: 'pronosticos',  Icon: TrendingUp,  label: 'Pronósticos' },
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
  competitions: Competition[];
  hasLiveMatches?: boolean;
  tvTab?: 'hoy' | 'manana';
  onTvTabChange?: (tab: 'hoy' | 'manana') => void;
  isTournament?: boolean;
  features?: { tv: boolean; predictions: boolean };
}

export function Navbar({
  view,
  onViewChange,
  competitionId,
  onCompetitionChange,
  competitions,
  hasLiveMatches = false,
  tvTab = 'hoy',
  onTvTabChange,
  isTournament = false,
  features,
}: NavbarProps) {
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';
  const isLeagueView = view !== 'home';
  const { theme, toggleTheme } = useTheme();

  // Filter nav items by feature flags (default: all enabled for backward compat)
  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (item.id === 'tv') return features?.tv !== false;
    if (item.id === 'pronosticos') return features?.predictions !== false;
    return true;
  });

  return (
    <header
      className="sticky top-0 z-50 backdrop-blur-xl"
      style={{
        background: 'var(--sp-header)',
        borderBottom: '1px solid var(--sp-border-5)',
        transition: 'background 0.2s ease',
      }}
    >
      {isMobile ? (
        /* ── MOBILE: fila única logo-izq · menú · toggle ────────────────── */
        <>
          {/* Fila 1: logo izquierda + menú + theme toggle */}
          <div style={{
            maxWidth: 1200, margin: '0 auto',
            padding: '8px 10px',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {/* Menú — ocupa el espacio restante centrado */}
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
              <NavPill view={view} onViewChange={onViewChange} isMobile={isMobile} hasLive={hasLiveMatches} isTournament={isTournament} items={visibleNavItems} />
            </div>

            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            <AuthArea />
          </div>

          {/* Fila 3: tabs TV -o- selector de liga según vista */}
          {isLeagueView && competitions.length > 0 && (
            <div style={{
              maxWidth: 1200, margin: '0 auto',
              padding: '0 14px 10px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {view === 'tv' ? (
                /* Tabs Hoy / Mañana inline */
                <div style={{
                  display: 'flex', gap: 4, padding: 3,
                  background: 'var(--sp-surface)',
                  border: '1px solid var(--sp-border-8)',
                  borderRadius: 9999,
                }}>
                  {(['hoy', 'manana'] as const).map((tab) => {
                    const isActive = tvTab === tab;
                    return (
                      <button
                        key={tab}
                        onClick={() => onTvTabChange?.(tab)}
                        style={{
                          padding: '5px 18px', borderRadius: 9999, border: 'none',
                          background: isActive ? 'var(--sp-primary-10)' : 'transparent',
                          color: isActive ? 'var(--sp-text)' : 'var(--sp-text-40)',
                          fontSize: 13, fontWeight: isActive ? 700 : 500,
                          cursor: 'pointer', minHeight: 36,
                          boxShadow: isActive ? 'inset 0 0 0 1px var(--sp-primary-40)' : 'none',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {tab === 'hoy' ? 'Hoy' : 'Mañana'}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <LeagueSelector value={competitionId} onChange={onCompetitionChange} options={competitions} />
              )}
            </div>
          )}
        </>
      ) : (
        /* ── DESKTOP: fila única ─────────────────────────────────────────── */
        <div
          style={{
            maxWidth: 1200, margin: '0 auto',
            padding: '10px 24px',
            display: 'flex', alignItems: 'center', gap: 16,
          }}
        >
          {/* Logo */}
          <button
            onClick={() => onViewChange('home')}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0, minHeight: 44 }}
            aria-label="SportsPulse — Inicio"
          >
            <img
              src="/logo.png"
              alt=""
              style={{ height: 56, width: 'auto', maxWidth: 260, objectFit: 'contain' }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          </button>

          {/* NavPill centrado */}
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
            <NavPill view={view} onViewChange={onViewChange} isMobile={false} hasLive={hasLiveMatches} isTournament={isTournament} items={visibleNavItems} />
          </div>

          {/* Zona derecha */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            {isLeagueView && competitions.length > 0 && (
              <LeagueSelector value={competitionId} onChange={onCompetitionChange} options={competitions} />
            )}
            <AuthArea />
          </div>
        </div>
      )}
    </header>
  );
}

// ─── AuthArea — auth state UI in the navbar ───────────────────────────────────

function AuthArea() {
  const { sessionStatus, email, loading, refresh } = useSession();

  if (loading || sessionStatus === 'loading' as string) return null;

  if (sessionStatus === 'anonymous' || sessionStatus === 'expired') {
    return (
      <button
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 12px',
          borderRadius: 9999,
          border: '1px solid var(--sp-border-8)',
          background: 'var(--sp-surface)',
          color: 'var(--sp-text-40)',
          fontSize: 12,
          fontWeight: 500,
          cursor: 'pointer',
          minHeight: 44,
          flexShrink: 0,
          transition: 'all 0.15s ease',
        }}
      >
        <LogIn size={14} strokeWidth={2} />
        <span>Iniciar sesión</span>
      </button>
    );
  }

  // sessionStatus === 'authenticated'
  const handleLogout = () => {
    apiClient.postLogout().catch(() => {}).finally(() => {
      refresh();
    });
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <span
        style={{
          fontSize: 12,
          color: 'var(--sp-text-40)',
          maxWidth: 140,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {email}
      </span>
      <button
        data-testid="navbar-logout-btn"
        onClick={handleLogout}
        title="Cerrar sesión"
        style={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--sp-border-8)',
          border: '1px solid var(--sp-border-8)',
          cursor: 'pointer',
          color: 'var(--sp-text-55)',
          transition: 'all 0.15s ease',
        }}
      >
        <LogOut size={14} strokeWidth={2} />
      </button>
    </div>
  );
}

// ─── NavPill — contenedor con floating glow pill ──────────────────────────────

function NavPill({
  view,
  onViewChange,
  isMobile,
  hasLive,
  isTournament,
  items,
}: {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  isMobile: boolean;
  hasLive: boolean;
  isTournament: boolean;
  items: typeof NAV_ITEMS;
}) {
  const visibleItems = items;

  const containerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pillStyle, setPillStyle] = useState({ left: 0, width: 0, opacity: 0 });

  useEffect(() => {
    const activeIndex = visibleItems.findIndex((item) => item.id === view);
    const tab = tabRefs.current[activeIndex];
    const container = containerRef.current;
    if (tab && container) {
      const cRect = container.getBoundingClientRect();
      const tRect = tab.getBoundingClientRect();
      setPillStyle({
        left: tRect.left - cRect.left,
        width: tRect.width,
        opacity: 1,
      });
    } else {
      setPillStyle((prev) => ({ ...prev, opacity: 0 }));
    }
  }, [view, isMobile, visibleItems]);

  return (
    <div
      ref={containerRef}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        position: 'relative',
        padding: '4px 6px',
        background: 'var(--sp-surface)',
        borderRadius: '9999px',
        border: '1px solid var(--sp-border-8)',
        transition: 'background 0.2s ease',
        gap: 0,
      }}
    >
      {/* Floating glow pill — se desplaza con spring CSS */}
      <div
        style={{
          position: 'absolute',
          top: 4,
          bottom: 4,
          left: pillStyle.left,
          width: pillStyle.width,
          borderRadius: '9999px',
          background: 'var(--sp-primary-10)',
          border: '1px solid var(--sp-primary-40)',
          boxShadow: '0 0 16px var(--sp-primary-10), inset 0 0 10px var(--sp-primary-04)',
          opacity: pillStyle.opacity,
          transition: [
            'left 0.4s cubic-bezier(0.34,1.56,0.64,1)',
            'width 0.35s cubic-bezier(0.34,1.56,0.64,1)',
            'opacity 0.2s ease',
          ].join(', '),
          pointerEvents: 'none',
        }}
      />

      {visibleItems.map((item, i) => (
        <NavTab
          key={item.id}
          ref={(el) => { tabRefs.current[i] = el; }}
          item={item}
          isActive={view === item.id}
          isMobile={isMobile}
          showPing={hasLive && item.id === 'tv'}
          onClick={() => onViewChange(item.id)}
        />
      ))}
    </div>
  );
}

// ─── NavTab — botón individual con icono Lucide + ping live ──────────────────

const NavTab = forwardRef<
  HTMLButtonElement,
  {
    item: (typeof NAV_ITEMS)[0];
    isActive: boolean;
    isMobile: boolean;
    showPing: boolean;
    onClick: () => void;
  }
>(({ item, isActive, isMobile, showPing, onClick }, ref) => {
  const { Icon, label } = item;

  return (
    <button
      ref={ref}
      onClick={onClick}
      style={{
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: isMobile ? 3 : 7,
        padding: isMobile ? '5px 12px' : '7px 16px',
        borderRadius: '9999px',
        border: 'none',
        background: 'transparent',
        color: isActive ? 'var(--sp-text)' : 'var(--sp-text-40)',
        fontSize: isMobile ? 10 : 12,
        fontWeight: isActive ? 700 : 500,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        minHeight: 44,
        transition: 'color 0.15s ease',
        letterSpacing: isActive ? '0.02em' : '0',
      }}
    >
      {/* Icono con ping opcional */}
      <div style={{ position: 'relative', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        <Icon size={isMobile ? 17 : 16} strokeWidth={isActive ? 2.5 : 2} />
        {showPing && (
          <span
            style={{
              position: 'absolute',
              top: -3,
              right: -3,
              display: 'flex',
              width: 8,
              height: 8,
            }}
          >
            <span
              className="animate-ping"
              style={{
                position: 'absolute',
                display: 'inline-flex',
                width: '100%',
                height: '100%',
                borderRadius: '9999px',
                backgroundColor: 'var(--sp-primary)',
                opacity: 0.75,
              }}
            />
            <span
              style={{
                position: 'relative',
                display: 'inline-flex',
                width: 8,
                height: 8,
                borderRadius: '9999px',
                backgroundColor: 'var(--sp-primary)',
                boxShadow: '0 0 6px var(--sp-primary)',
              }}
            />
          </span>
        )}
      </div>

      {/* Etiqueta — siempre visible; debajo del icono en mobile */}
      <span>{label}</span>
    </button>
  );
});
NavTab.displayName = 'NavTab';

// ─── StandingsButton — acceso rápido a la tabla desde otras vistas ────────────

function StandingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Ver tabla"
      style={{
        width: 34,
        height: 34,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--sp-border)',
        border: '1px solid var(--sp-border-8)',
        cursor: 'pointer',
        color: 'var(--sp-text-55)',
        flexShrink: 0,
        transition: 'all 0.15s ease',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--sp-primary-40)';
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--sp-primary)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--sp-border-8)';
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--sp-text-55)';
      }}
    >
      <Trophy size={14} strokeWidth={2} />
    </button>
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
        width: 44,
        height: 44,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: isLight ? 'var(--sp-primary-10)' : 'var(--sp-border-8)',
        border: '1px solid var(--sp-border-8)',
        cursor: 'pointer',
        color: isLight ? 'var(--sp-primary)' : 'var(--sp-secondary)',
        transition: 'all 0.15s ease',
        flexShrink: 0,
      }}
    >
      {isLight ? <Moon size={14} strokeWidth={2.5} /> : <Sun size={14} strokeWidth={2.5} />}
    </button>
  );
}
