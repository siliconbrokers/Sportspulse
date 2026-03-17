/**
 * competition-meta.ts — Metadatos de competencias para el frontend.
 *
 * Fuente de verdad: DEFAULT_CONFIG en use-portal-config.ts (espejo del backend registry).
 * Este módulo DERIVA todos sus mapas desde esa fuente — no duplica ningún dato.
 *
 * En runtime, los componentes que necesitan metadatos actualizados (post-admin-config)
 * deben usar usePortalConfig() y llamar a buildCompetitionMaps().
 * Los mapas estáticos exportados aquí sirven como fallback síncrono.
 */
import type { CompetitionEntry } from '../hooks/use-portal-config.js';
import { DEFAULT_CONFIG } from '../hooks/use-portal-config.js';

export type TournamentPhase = 'previa' | 'grupos' | 'eliminatorias';

export interface CompetitionMeta {
  id: string;
  name: string;
  shortName: string;
  logoUrl: string;
  accent: string;
  season: string;
  startDate?: string;
  phases?: TournamentPhase[];
}

/** Builds CompetitionMeta[] from portal config entries */
export function buildCompetitionMetaList(entries: CompetitionEntry[]): CompetitionMeta[] {
  return entries
    .filter((e) => e.logoUrl && e.accentColor)
    .map((e) => ({
      id:        e.id,
      name:      e.displayName,
      shortName: e.slug,
      logoUrl:   e.logoUrl!,
      accent:    e.accentColor!,
      season:    e.seasonLabel ?? '',
      startDate: e.startDate ?? undefined,
      phases:    (e.phases ?? undefined) as TournamentPhase[] | undefined,
    }));
}

/** Lookup maps derived from a CompetitionEntry[] */
export interface CompetitionMaps {
  compIdToNewsKey:          Record<string, string>;
  compIdToNormalizedLeague: Record<string, string>;
  managedNormalizedLeagues: Set<string>;
  compIdToAccent:           Record<string, string>;
  compIdToIsTournament:     Record<string, boolean>;
}

export function buildCompetitionMaps(entries: CompetitionEntry[]): CompetitionMaps {
  const compIdToNewsKey:          Record<string, string>  = {};
  const compIdToNormalizedLeague: Record<string, string>  = {};
  const compIdToAccent:           Record<string, string>  = {};
  const compIdToIsTournament:     Record<string, boolean> = {};

  for (const e of entries) {
    if (e.newsKey)          compIdToNewsKey[e.id]          = e.newsKey;
    if (e.normalizedLeague) compIdToNormalizedLeague[e.id] = e.normalizedLeague;
    if (e.accentColor)      compIdToAccent[e.id]           = e.accentColor;
    compIdToIsTournament[e.id] = e.isTournament ?? false;
  }

  return {
    compIdToNewsKey,
    compIdToNormalizedLeague,
    managedNormalizedLeagues: new Set(Object.values(compIdToNormalizedLeague)),
    compIdToAccent,
    compIdToIsTournament,
  };
}

// ── Static fallbacks (derived from DEFAULT_CONFIG — no duplication) ───────────

const _static = buildCompetitionMaps(DEFAULT_CONFIG.competitions);

/** Mapa competition ID → league key usado en noticias/videos */
export const COMP_ID_TO_NEWS_KEY: Record<string, string> = _static.compIdToNewsKey;

/** Mapa competition ID → normalizedLeague (usado en TV, LiveCarousel, etc.) */
export const COMP_ID_TO_NORMALIZED_LEAGUE: Record<string, string> = _static.compIdToNormalizedLeague;

/** Todas las ligas gestionadas (pueden deshabilitarse desde el Back Office) */
export const MANAGED_NORMALIZED_LEAGUES: Set<string> = _static.managedNormalizedLeagues;

/** Mapa competition ID → accent color */
export const COMP_ID_TO_ACCENT: Record<string, string> = _static.compIdToAccent;

/** Mapa normalizedLeague → accent color (para LiveCarousel y otros por normalized key) */
export const NORMALIZED_LEAGUE_TO_ACCENT: Record<string, string> = Object.fromEntries(
  DEFAULT_CONFIG.competitions
    .filter((e) => e.normalizedLeague && e.accentColor)
    .map((e) => [e.normalizedLeague!, e.accentColor!]),
);

/** Static list — used by components that need logo/season info */
export const COMPETITION_META: CompetitionMeta[] = buildCompetitionMetaList(DEFAULT_CONFIG.competitions);

export function getCompMeta(id: string): CompetitionMeta | undefined {
  return COMPETITION_META.find((c) => c.id === id);
}

// ── Display order constants ────────────────────────────────────────────────────

/** Orden de bloques en NewsSection y feeds de noticias del home. */
export const NEWS_LEAGUE_ORDER = ['URU', 'AR', 'LL', 'EPL', 'BUN'] as const;

/** Orden de bloques en VideoSection (incluye CLI una vez tenga soporte de video). */
export const VIDEO_LEAGUE_ORDER = ['URU', 'AR', 'LL', 'EPL', 'BUN', 'CLI'] as const;

/**
 * Mapa competition ID → canal de stream en futbollibretv.su.
 * Solo para competiciones cuya señal está disponible en ese sitio.
 * Canal VTV: Liga Uruguaya.
 */
export const COMP_ID_TO_FLTV_CHANNEL: Record<
  string,
  { label: string; sourcePageUrl: string; fallbackUrl: string }
> = {
  'comp:apifootball:268': {
    label:         'VTV',
    sourcePageUrl: 'https://futbollibretv.su/vtv/',
    fallbackUrl:   'https://futbollibretv.su/vtv/',
  },
};
