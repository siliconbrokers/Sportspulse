import { useState, useEffect, useRef } from 'react';

export interface CompetitionEntry {
  id: string;
  slug: string;
  displayName: string;
  enabled: boolean;
}

export interface PortalFeatures {
  tv: boolean;
  predictions: boolean;
}

export interface PortalConfig {
  competitions: CompetitionEntry[];
  features: PortalFeatures;
}

// Fallback: todas habilitadas — mismo comportamiento que antes de esta feature
const DEFAULT_CONFIG: PortalConfig = {
  competitions: [
    { id: 'comp:thesportsdb:4432', slug: 'URU', displayName: 'Fútbol Uruguayo', enabled: true },
    { id: 'comp:sportsdb-ar:4406', slug: 'AR', displayName: 'Liga Argentina', enabled: true },
    { id: 'comp:football-data:PD', slug: 'PD', displayName: 'La Liga', enabled: true },
    { id: 'comp:football-data:PL', slug: 'PL', displayName: 'Premier League', enabled: true },
    { id: 'comp:openligadb:bl1', slug: 'BL1', displayName: 'Bundesliga', enabled: true },
    {
      id: 'comp:football-data-cli:CLI',
      slug: 'CLI',
      displayName: 'Copa Libertadores',
      enabled: true,
    },
    {
      id: 'comp:football-data-wc:WC',
      slug: 'WC',
      displayName: 'Copa del Mundo 2026',
      enabled: true,
    },
  ],
  features: { tv: true, predictions: true },
};

const RETRY_INTERVAL_MS = 3000;

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
        setTimeout(() => {
          void tryFetch();
        }, RETRY_INTERVAL_MS);
      }
    }

    void tryFetch();

    return () => {
      cancelledRef.current = true;
    };
  }, []);

  return { config, loading, serverReady };
}
