import { useState, useEffect, useRef } from 'react';

export interface CompetitionEntry {
  id: string;
  slug: string;
  displayName: string;
  enabled: boolean;
  mode?: 'portal' | 'shadow' | 'disabled';
  /** Stable semantic key for frontend filtering (e.g. 'LALIGA', 'PREMIER_LEAGUE') */
  normalizedLeague?: string;
  /** Key for news/video section grouping (e.g. 'LL', 'EPL'). Null = no dedicated feed. */
  newsKey?: string | null;
  /** UI accent color */
  accentColor?: string;
  /** True for knockout tournaments (Copa Libertadores, Copa del Mundo) */
  isTournament?: boolean;
  /** Logo image URL */
  logoUrl?: string | null;
  /** Season display label (e.g. '25/26' or '2026') */
  seasonLabel?: string | null;
  /** Tournament phases for tab display */
  phases?: string[] | null;
  /** Tournament start date (ISO) for pre-tournament banner */
  startDate?: string | null;
}

export interface PortalFeatures {
  tv: boolean;
  predictions: boolean;
}

export interface PortalConfig {
  competitions: CompetitionEntry[];
  features: PortalFeatures;
}

/**
 * Fallback estático — espejo del COMPETITION_REGISTRY del backend.
 * Se usa mientras el servidor no haya respondido con la config real.
 * Fuente de verdad frontend: aquí se define una sola vez toda la metadata visual.
 */
export const DEFAULT_CONFIG: PortalConfig = {
  competitions: [
    {
      id: 'comp:apifootball:268',
      slug: 'URU',
      displayName: 'Fútbol Uruguayo',
      enabled: true,
      mode: 'portal',
      normalizedLeague: 'URUGUAY_PRIMERA',
      newsKey: 'URU',
      accentColor: '#3b82f6',
      isTournament: false,
      logoUrl: 'https://r2.thesportsdb.com/images/media/league/badge/3p98xv1740672448.png',
      seasonLabel: '2026',
    },
    {
      id: 'comp:apifootball:128',
      slug: 'AR',
      displayName: 'Liga Argentina',
      enabled: true,
      mode: 'portal',
      normalizedLeague: 'ARGENTINA_PRIMERA',
      newsKey: 'AR',
      accentColor: '#74b9ff',
      isTournament: false,
      logoUrl: 'https://r2.thesportsdb.com/images/media/league/badge/rk9xhx1768238251.png',
      seasonLabel: '2026',
    },
    {
      id: 'comp:apifootball:140',
      slug: 'PD',
      displayName: 'La Liga',
      enabled: true,
      mode: 'portal',
      normalizedLeague: 'LALIGA',
      newsKey: 'LL',
      accentColor: '#f59e0b',
      isTournament: false,
      logoUrl: 'https://r2.thesportsdb.com/images/media/league/badge/ja4it51687628717.png',
      seasonLabel: '25/26',
    },
    {
      id: 'comp:apifootball:39',
      slug: 'PL',
      displayName: 'Premier League',
      enabled: true,
      mode: 'portal',
      normalizedLeague: 'PREMIER_LEAGUE',
      newsKey: 'EPL',
      accentColor: '#a855f7',
      isTournament: false,
      logoUrl: 'https://r2.thesportsdb.com/images/media/league/badge/gasy9d1737743125.png',
      seasonLabel: '25/26',
    },
    {
      id: 'comp:apifootball:78',
      slug: 'BL1',
      displayName: 'Bundesliga',
      enabled: true,
      mode: 'portal',
      normalizedLeague: 'BUNDESLIGA',
      newsKey: 'BUN',
      accentColor: '#ef4444',
      isTournament: false,
      logoUrl: 'https://r2.thesportsdb.com/images/media/league/badge/teqh1b1679952008.png',
      seasonLabel: '25/26',
    },
    {
      id: 'comp:apifootball:13',
      slug: 'CLI',
      displayName: 'Copa Libertadores',
      enabled: true,
      mode: 'portal',
      normalizedLeague: 'COPA_LIBERTADORES',
      newsKey: 'CLI',
      accentColor: '#eab308',
      isTournament: true,
      logoUrl: 'https://crests.football-data.org/CLI.svg',
      seasonLabel: '2026',
      phases: ['previa', 'grupos', 'eliminatorias'],
    },
    {
      id: 'comp:apifootball:1',
      slug: 'WC',
      displayName: 'Copa del Mundo 2026',
      enabled: true,
      mode: 'portal',
      normalizedLeague: 'MUNDIAL',
      newsKey: 'WC',
      accentColor: '#22c55e',
      isTournament: true,
      logoUrl: 'https://r2.thesportsdb.com/images/media/league/badge/e7er5g1696521789.png',
      seasonLabel: '2026',
      phases: ['grupos', 'eliminatorias'],
      startDate: '2026-06-11',
    },
    {
      id: 'comp:apifootball:262',
      slug: 'MX',
      displayName: 'Liga MX',
      enabled: false,
      mode: 'disabled',
      normalizedLeague: 'LIGA_MX',
      newsKey: null,
      accentColor: '#1a1a6e',
      isTournament: false,
      logoUrl: 'https://r2.thesportsdb.com/images/media/league/badge/mav5rx1686157960.png',
      seasonLabel: '25/26',
    },
    {
      id: 'comp:apifootball:71',
      slug: 'BR',
      displayName: 'Brasileirão Série A',
      enabled: false,
      mode: 'portal',
      normalizedLeague: 'BRASILEIRAO',
      newsKey: null,
      accentColor: '#009c3b',
      isTournament: false,
      logoUrl: 'https://r2.thesportsdb.com/images/media/league/badge/lywv7t1766787179.png',
      seasonLabel: '2026',
    },
    {
      id: 'comp:apifootball:135',
      slug: 'SA',
      displayName: 'Serie A',
      enabled: false,
      mode: 'portal',
      normalizedLeague: 'SERIE_A',
      newsKey: null,
      accentColor: '#003087',
      isTournament: false,
      logoUrl: 'https://r2.thesportsdb.com/images/media/league/badge/67q3q21679951383.png',
      seasonLabel: '25/26',
    },
    {
      id: 'comp:apifootball:94',
      slug: 'PT',
      displayName: 'Primeira Liga',
      enabled: false,
      mode: 'portal',
      normalizedLeague: 'PRIMEIRA_LIGA',
      newsKey: null,
      accentColor: '#00843D',
      isTournament: false,
      logoUrl: 'https://r2.thesportsdb.com/images/media/league/badge/lkfko71751917970.png',
      seasonLabel: '25/26',
    },
    {
      id: 'comp:apifootball:265',
      slug: 'CL',
      displayName: 'Primera División',
      enabled: false,
      mode: 'portal',
      normalizedLeague: 'PRIMERA_DIVISION_CL',
      newsKey: null,
      accentColor: '#CC0000',
      isTournament: false,
      logoUrl: 'https://r2.thesportsdb.com/images/media/league/badge/x9m78e1768232019.png',
      seasonLabel: '2026',
    },
  ],
  features: { tv: true, predictions: true },
};

const RETRY_INTERVAL_MS = 3000;
const POLL_INTERVAL_MS = 60_000;

export function usePortalConfig(): {
  config: PortalConfig;
  loading: boolean;
  serverReady: boolean;
} {
  const [config, setConfig] = useState<PortalConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [serverReady, setServerReady] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    async function tryFetch() {
      if (cancelledRef.current) return;
      try {
        const res = await fetch('/api/ui/portal-config');
        if (cancelledRef.current) return;

        if (res.ok) {
          const data: PortalConfig = await res.json();
          if (!cancelledRef.current && data?.competitions && data?.features) {
            setConfig(data);
          }
          if (!cancelledRef.current) {
            setServerReady(true);
            setLoading(false);
          }
        } else {
          // 5xx = servidor arrancando — reintenta
          scheduleRetry();
        }
      } catch {
        // fetch falló (ECONNREFUSED, red) — reintenta
        scheduleRetry();
      }
    }

    function scheduleRetry() {
      if (!cancelledRef.current) {
        retryTimer = setTimeout(() => void tryFetch(), RETRY_INTERVAL_MS);
      }
    }

    void tryFetch();
    const pollInterval = setInterval(() => void tryFetch(), POLL_INTERVAL_MS);

    return () => {
      cancelledRef.current = true;
      clearInterval(pollInterval);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  return { config, loading, serverReady };
}
