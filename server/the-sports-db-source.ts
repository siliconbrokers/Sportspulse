import type { Team, Match } from '@sportpulse/canonical';
import {
  classifyStatus,
  classifyPeriod,
  Sport,
  competitionId as canonicalCompId,
  seasonId as canonicalSeasonId,
  teamId as canonicalTeamId,
  matchId as canonicalMatchId,
  resolveDisplayName,
} from '@sportpulse/canonical';
import type { DataSource, StandingEntry, SubTournamentInfo } from '@sportpulse/snapshot';
import { persistTeamsCache, loadTeamsCache, persistScoreSnapshot, loadScoreSnapshot } from './matchday-cache.js';
import { resolveTla } from './tla-overrides.js';
import { readRawCache, writeRawCache } from './raw-response-cache.js';
import { CrestCache } from './crest-cache.js';
import { applyMatchStatusGuard } from './match-status-guard.js';

// ── Provider key ─────────────────────────────────────────────────────────────

export const SPORTSDB_PROVIDER_KEY = 'thesportsdb';

/**
 * Explicit definition of a sub-tournament within a league season.
 * When provided, bypasses bimodal auto-detection.
 * isH1: true = Jan–Jun half, false = Jul–Dec half.
 */
export interface SubTournamentDef {
  key: string;
  label: string;
  isH1: boolean;
}

// ── TheSportsDB raw response types ───────────────────────────────────────────

interface SDBEvent {
  idEvent: string;
  idHomeTeam: string;
  idAwayTeam: string;
  strHomeTeam: string;
  strAwayTeam: string;
  strHomeTeamBadge?: string;
  strAwayTeamBadge?: string;
  dateEvent: string;  // "YYYY-MM-DD"
  strTime: string;    // "HH:MM:SS" UTC
  intHomeScore: string | null;
  intAwayScore: string | null;
  strStatus: string;
  intRound: string;
  strSeason: string;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

interface CachedData {
  teams: Team[];
  matches: Match[];
  seasonId: string;
  currentMatchday: number | undefined;
  fetchedAt: number;
  /** Non-empty when the season is split into named sub-tournaments (Clausura/Apertura). */
  subTournaments: SubTournamentInfo[];
  /** The key of the currently-active sub-tournament, if any. */
  activeSubTournamentKey: string | undefined;
}

const CACHE_TTL_MS      = 10 * 60 * 1000;       // 10 min — in-memory
const DISK_CACHE_TTL_MS = 6 * 60 * 60 * 1000;  // 6h  — disco

// ── DataSource implementation ─────────────────────────────────────────────────

/**
 * DataSource backed by TheSportsDB API v1 (free tier).
 *
 * Fetches teams and season events for a given league, normalizes them to the
 * canonical model, and caches results in memory.
 *
 * All logging includes: provider name, league ID, endpoint, elapsed time,
 * cache hit/miss, and error details.
 */
export class TheSportsDbSource implements DataSource {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly leagueId: string;
  private readonly leagueName: string;
  private readonly _competitionId: string;
  readonly providerKey: string;
  private cache: CachedData | null = null;
  private readonly crestCache = new CrestCache();
  private readonly knownSubTournaments: SubTournamentDef[] | undefined;

  constructor(
    apiKey: string,
    leagueId: string,
    leagueName: string,
    baseUrl = 'https://www.thesportsdb.com/api/v1/json',
    providerKey = SPORTSDB_PROVIDER_KEY,
    knownSubTournaments?: SubTournamentDef[],
  ) {
    this.apiKey = apiKey;
    this.leagueId = leagueId;
    this.leagueName = leagueName;
    this.baseUrl = baseUrl;
    this.providerKey = providerKey;
    this._competitionId = canonicalCompId(providerKey, leagueId);
    this.knownSubTournaments = knownSubTournaments;
  }

  getTeams(compId: string): Team[] {
    if (!this.owns(compId)) return [];
    const hit = this.getCached();
    console.log(`[TheSportsDbSource] getTeams(${compId}) cache=${hit ? 'HIT' : 'MISS'}`);
    return hit?.teams ?? [];
  }

  getMatches(seasId: string, subTournamentKey?: string): Match[] {
    const hit = this.getCached();
    if (!hit || hit.seasonId !== seasId) return [];
    const key = subTournamentKey ?? hit.activeSubTournamentKey;
    if (!key) return hit.matches;
    return hit.matches.filter((m) => m.subTournamentKey === key);
  }

  getSeasonId(compId: string): string | undefined {
    if (!this.owns(compId)) return undefined;
    return this.getCached()?.seasonId;
  }

  getStandings(compId: string, subTournamentKey?: string): StandingEntry[] {
    if (!this.owns(compId)) return [];
    const hit = this.getCached();
    if (!hit) return [];
    const key = subTournamentKey ?? hit.activeSubTournamentKey;
    const matches = key ? hit.matches.filter((m) => m.subTournamentKey === key) : hit.matches;
    return computeStandings(matches, hit.teams);
  }

  getSubTournaments(compId: string): SubTournamentInfo[] {
    if (!this.owns(compId)) return [];
    return this.getCached()?.subTournaments ?? [];
  }

  getActiveSubTournament(compId: string): string | undefined {
    if (!this.owns(compId)) return undefined;
    return this.getCached()?.activeSubTournamentKey;
  }

  getCurrentMatchday(compId: string, subTournamentKey?: string): number | undefined {
    if (!this.owns(compId)) return undefined;
    return this.getBestDisplayMatchday(compId, subTournamentKey) ?? this.getCached()?.currentMatchday;
  }

  getLastPlayedMatchday(compId: string, subTournamentKey?: string): number | undefined {
    if (!this.owns(compId)) return undefined;
    const hit = this.getCached();
    if (!hit) return undefined;
    const key = subTournamentKey ?? hit.activeSubTournamentKey;
    const matches = key ? hit.matches.filter((m) => m.subTournamentKey === key) : hit.matches;
    return computeLastPlayedMatchday(matches);
  }

  getNextMatchday(compId: string, subTournamentKey?: string): number | undefined {
    if (!this.owns(compId)) return undefined;
    const hit = this.getCached();
    if (!hit) return undefined;
    const key = subTournamentKey ?? hit.activeSubTournamentKey;
    const matches = key ? hit.matches.filter((m) => m.subTournamentKey === key) : hit.matches;
    const nowUtc = new Date().toISOString();
    let next: number | undefined = undefined;
    for (const m of matches) {
      if (
        m.matchday === undefined ||
        m.status !== 'SCHEDULED' ||
        !m.startTimeUtc ||
        m.startTimeUtc <= nowUtc
      )
        continue;
      if (next === undefined || m.matchday < next) next = m.matchday;
    }
    return next;
  }

  getBestDisplayMatchday(compId: string, subTournamentKey?: string): number | undefined {
    if (!this.owns(compId)) return undefined;
    const hit = this.getCached();
    if (!hit) return undefined;
    const key = subTournamentKey ?? hit.activeSubTournamentKey;
    const matches = key ? hit.matches.filter((m) => m.subTournamentKey === key) : hit.matches;

    const nowMs = Date.now();
    let liveMd: number | undefined;
    let earliestUpcomingMs = Infinity;
    let earliestUpcomingMd: number | undefined;
    let highestFinished: number | undefined;

    for (const m of matches) {
      if (m.matchday === undefined) continue;
      const t = m.startTimeUtc ? new Date(m.startTimeUtc).getTime() : 0;
      if (m.status === 'IN_PROGRESS') {
        liveMd = m.matchday;
      } else if (m.status === 'FINISHED') {
        if (highestFinished === undefined || m.matchday > highestFinished) highestFinished = m.matchday;
      } else if (m.status === 'SCHEDULED' && t > nowMs) {
        if (t < earliestUpcomingMs) { earliestUpcomingMs = t; earliestUpcomingMd = m.matchday; }
      }
    }

    if (liveMd !== undefined) return liveMd;
    if (earliestUpcomingMd !== undefined) return earliestUpcomingMd;
    return highestFinished ?? deriveCurrentMatchday(matches);
  }

  getTotalMatchdays(compId: string, subTournamentKey?: string): number {
    if (!this.owns(compId)) return 15;
    const hit = this.getCached();
    if (!hit) return 15;
    const key = subTournamentKey ?? hit.activeSubTournamentKey;
    const matches = key ? hit.matches.filter((m) => m.subTournamentKey === key) : hit.matches;
    const rounds = new Set(matches.map((m) => m.matchday).filter((m): m is number => m != null));
    return rounds.size || 15;
  }

  /**
   * Fetches and caches all data for the given season (defaults to current year).
   * Must be called before getTeams/getMatches will return data.
   */
  async fetchSeason(season?: string): Promise<void> {
    const s = season ?? String(new Date().getFullYear());
    const seasId = canonicalSeasonId(this.providerKey, `${this.leagueId}-${s}`);
    const nowUtc = new Date().toISOString();
    const t0 = Date.now();

    console.log(
      `[TheSportsDbSource] Fetching league=${this.leagueId} (${this.leagueName}) season=${s}...`,
    );

    const diskKey = `sportsdb-${this.leagueId}-${s}`;
    let rawEvents: SDBEvent[];

    // Intentar leer desde caché de disco.
    // Bypass si algún evento tiene kickoff en los últimos 180 min (partido activo o recién finalizado)
    // OR si algún evento tiene más de 180 min transcurridos pero sigue con status no-terminal en el
    // cache (cache escrito durante el partido, nunca actualizado con el resultado final).
    const LIVE_BYPASS_WINDOW_MS = 180 * 60 * 1000;
    const TERMINAL_STATUSES = new Set([
      'FT', 'FINAL', 'FINISHED', 'AWARDED', 'MATCH FINISHED', 'Match Finished',
      'MATCH POSTPONED', 'Match Postponed', 'MATCH CANCELLED', 'Match Cancelled',
      'MATCH ABANDONED', 'POSTPONED', 'CANCELED', 'CANCELLED',
    ]);
    const diskHit = await readRawCache<SDBEvent[]>(diskKey, DISK_CACHE_TTL_MS);
    const needsBypass = diskHit?.some((e) => {
      if (!e.dateEvent || !e.strTime) return false;
      const kickoffMs = new Date(`${e.dateEvent}T${e.strTime}Z`).getTime();
      const elapsed = Date.now() - kickoffMs;
      if (elapsed <= 0) return false; // no empezó
      const isTerminal = TERMINAL_STATUSES.has(e.strStatus ?? '');
      if (elapsed <= LIVE_BYPASS_WINDOW_MS) return true; // dentro de ventana activa
      // Partido debería haber terminado (>180 min) pero el cache aún tiene status live
      return !isTerminal;
    }) ?? false;
    if (diskHit && !needsBypass) {
      console.log(`[TheSportsDbSource] DISK_HIT league=${this.leagueId} season=${s}`);
      rawEvents = diskHit;
    } else {
      if (diskHit && needsBypass) {
        console.log(`[TheSportsDbSource] DISK_BYPASS league=${this.leagueId} season=${s} (scores desactualizados o partidos en juego)`);
      }
      // Phase 1: fetch season events + extra rounds in parallel
      // TheSportsDB's eventsseason endpoint lags behind — fetch extra rounds explicitly.
      const eventsResp = await this.apiGet<{ events: SDBEvent[] | null }>(
        `/eventsseason.php?id=${this.leagueId}&s=${s}`,
      );
      const seasonEvents = eventsResp.events ?? [];

      const maxSeasonRound = seasonEvents.reduce(
        (max, e) => Math.max(max, parseInt(e.intRound, 10) || 0),
        0,
      );

      // Fetch 25 extra rounds ahead. eventsseason.php is unreliable — it sometimes
      // only returns already-played rounds, missing scheduled ones. For leagues like
      // the Argentine Primera División, eventsseason returns only Round 1, so we need
      // enough extra rounds to cover the full season (up to ~16-17 rounds for Clausura).
      const extraRoundNumbers = Array.from({ length: 25 }, (_, i) => maxSeasonRound + 1 + i);
      const extraRoundResults = await Promise.all(
        extraRoundNumbers.map((r) =>
          this.apiGet<{ events: SDBEvent[] | null }>(
            `/eventsround.php?id=${this.leagueId}&r=${r}&s=${s}`,
          ).catch(() => ({ events: null })),
        ),
      );
      const extraEvents = extraRoundResults.flatMap((r) => r.events ?? []);

      // Merge all events: deduplicate by idEvent and filter to the expected season
      // (eventsround.php can return events from previous seasons if the round doesn't exist yet)
      const seenEvents = new Set(seasonEvents.map((e) => e.idEvent));
      rawEvents = [
        ...seasonEvents,
        ...extraEvents.filter(
          (e) =>
            e.strSeason === s && !seenEvents.has(e.idEvent) && !!seenEvents.add(e.idEvent),
        ),
      ];

      // Persistir en disco (datos crudos completos — el filtro se aplica después)
      await writeRawCache<SDBEvent[]>(diskKey, rawEvents);
    }

    // Tag each event with its sub-tournament key (Clausura/Apertura) if applicable,
    // or leave untagged for single-window leagues.
    const { events: taggedEvents, subTournaments, activeSubTournamentKey } =
      tagTournamentHalves(rawEvents, s, this.knownSubTournaments);

    // Phase 2: build team registry directly from event data.
    // Each event carries strHomeTeamBadge / strAwayTeamBadge, so we don't need
    // lookupteam.php (which returns wrong data for non-featured leagues on the free tier).
    // Use the last-seen badge URL per team ID (all events for the same team share the same URL).
    const teamIdMap = new Map<string, string>(); // providerTeamId → canonicalTeamId
    const teams: Team[] = [];

    const upsertTeam = (id: string, name: string, badgeUrl?: string) => {
      if (!teamIdMap.has(id)) {
        const canonId = canonicalTeamId(this.providerKey, id);
        teams.push({
          teamId: canonId,
          sportId: Sport.FOOTBALL,
          name,
          shortName: resolveDisplayName(name),
          tla: resolveTla(name),
          crestUrl: badgeUrl || undefined,
          providerKey: this.providerKey,
          providerTeamId: id,
        });
        teamIdMap.set(id, canonId);
      } else if (badgeUrl) {
        // Update badge if we now have one and previously didn't
        const entry = teams.find((t) => t.providerTeamId === id);
        if (entry && !entry.crestUrl) entry.crestUrl = badgeUrl;
      }
    };

    for (const e of taggedEvents) {
      upsertTeam(e.idHomeTeam, e.strHomeTeam, e.strHomeTeamBadge);
      upsertTeam(e.idAwayTeam, e.strAwayTeam, e.strAwayTeamBadge);
    }

    // Build a map of previously-known scores to guard against score regression.
    // TheSportsDB sometimes returns null scores for FINISHED matches even though
    // a previous fetch had the correct scores. If the API now returns null for a
    // FINISHED match that we already have scores for, we keep the old data.
    //
    // Fix A2: seed from disk snapshot when in-memory cache is empty (after restart).
    // Without this, the guard was blind on the first fetch after a server restart.
    const prevScoreMap = new Map<string, { scoreHome: number | null; scoreAway: number | null }>();
    if (this.cache) {
      for (const m of this.cache.matches) {
        if (m.status === 'FINISHED' && (m.scoreHome !== null || m.scoreAway !== null)) {
          prevScoreMap.set(m.providerMatchId, { scoreHome: m.scoreHome, scoreAway: m.scoreAway });
        }
      }
    } else {
      // First fetch after restart: load from disk so regression guard is active immediately
      const diskSnapshot = loadScoreSnapshot(this.providerKey, this.leagueId);
      if (diskSnapshot) {
        for (const [k, v] of diskSnapshot) prevScoreMap.set(k, v);
        console.log(`[TheSportsDbSource] score-snapshot loaded from disk (${prevScoreMap.size} entries) league=${this.leagueId}`);
      }
    }

    // Map events → canonical matches
    const matches: Match[] = [];
    for (const e of taggedEvents) {
      const homeTeamId = teamIdMap.get(e.idHomeTeam);
      const awayTeamId = teamIdMap.get(e.idAwayTeam);
      if (!homeTeamId || !awayTeamId) {
        console.warn(`[TheSportsDbSource] Unresolvable teams for event ${e.idEvent}, skipping`);
        continue;
      }

      const startTimeUtc =
        e.dateEvent && e.strTime ? `${e.dateEvent}T${e.strTime}Z` : null;

      const status = applyMatchStatusGuard(classifyStatus(e.strStatus), startTimeUtc);
      const matchPeriod = status === 'IN_PROGRESS' ? classifyPeriod(e.strStatus) : undefined;

      let scoreHome: number | null =
        e.intHomeScore !== null && e.intHomeScore !== ''
          ? Number(e.intHomeScore)
          : null;
      let scoreAway: number | null =
        e.intAwayScore !== null && e.intAwayScore !== ''
          ? Number(e.intAwayScore)
          : null;

      // Score regression guard: if API returns null scores for a FINISHED match
      // that we previously had scores for, preserve the known-good scores.
      if (status === 'FINISHED' && scoreHome === null && scoreAway === null) {
        const prev = prevScoreMap.get(e.idEvent);
        if (prev) {
          scoreHome = prev.scoreHome;
          scoreAway = prev.scoreAway;
          console.log(`[TheSportsDbSource] Score regression guard: preserved scores for event ${e.idEvent}`);
        }
      }

      matches.push({
        matchId: canonicalMatchId(this.providerKey, e.idEvent),
        seasonId: seasId,
        matchday: parseInt(e.intRound, 10) || undefined,
        startTimeUtc,
        status,
        matchPeriod,
        homeTeamId,
        awayTeamId,
        scoreHome,
        scoreAway,
        providerKey: this.providerKey,
        providerMatchId: e.idEvent,
        lastSeenUtc: nowUtc,
        subTournamentKey: (e as SDBEvent & { _subTournamentKey?: string })._subTournamentKey ?? null,
      });
    }

    // Compute currentMatchday from the active sub-tournament only (or all matches if no split)
    const matchesForMatchday = activeSubTournamentKey
      ? matches.filter((m) => m.subTournamentKey === activeSubTournamentKey)
      : matches;
    const currentMatchday = deriveCurrentMatchday(matchesForMatchday);
    const elapsed = Date.now() - t0;

    console.log(
      `[TheSportsDbSource] Done league=${this.leagueId} season=${s}: ` +
        `teams=${teams.length}, matches=${matches.length}, ` +
        `currentMatchday=${currentMatchday ?? 'none'} (${elapsed}ms)`,
    );

    // Persist teams to disk for recovery after rate-limit restarts
    persistTeamsCache(this.providerKey, this.leagueId, teams);

    // Fix A2: persist known-good scores to disk so regression guard survives restarts
    const scoreSnapshot = new Map<string, { scoreHome: number | null; scoreAway: number | null }>();
    for (const m of matches) {
      if (m.status === 'FINISHED' && (m.scoreHome !== null || m.scoreAway !== null)) {
        scoreSnapshot.set(m.providerMatchId, { scoreHome: m.scoreHome, scoreAway: m.scoreAway });
      }
    }
    persistScoreSnapshot(this.providerKey, this.leagueId, scoreSnapshot);

    this.cache = {
      teams,
      matches,
      seasonId: seasId,
      currentMatchday,
      fetchedAt: Date.now(),
      subTournaments,
      activeSubTournamentKey,
    };

    // Fire-and-forget: download and cache crest images locally.
    this.crestCache.warmup(
      teams
        .filter((t) => t.providerTeamId)
        .map((t) => ({ providerTeamId: t.providerTeamId!, crestUrl: t.crestUrl })),
      this.providerKey,
    ).then((urlMap) => {
      if (!this.cache) return;
      this.cache = {
        ...this.cache,
        teams: this.cache.teams.map((t) => ({
          ...t,
          crestUrl: t.providerTeamId ? (urlMap.get(t.providerTeamId) ?? t.crestUrl) : t.crestUrl,
        })),
      };
      console.log(`[TheSportsDbSource] crest cache warm (${urlMap.size} teams)`);
    }).catch((err) => {
      console.warn('[TheSportsDbSource] crest warmup error:', err);
    });
  }

  private owns(compId: string): boolean {
    return compId === this._competitionId;
  }

  private getCached(): CachedData | null {
    if (!this.cache) return null;
    // Always return cached data even if stale — the periodic setInterval handles
    // refreshes. Stale data is far better than returning null → empty arrays.
    return this.cache;
  }

  private async apiGet<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}/${this.apiKey}${path}`;
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      const elapsed = Date.now() - t0;
      console.error(
        `[TheSportsDbSource] Network error for ${path} (${elapsed}ms):`,
        err,
      );
      throw err;
    }
    const elapsed = Date.now() - t0;
    if (!res.ok) {
      console.error(
        `[TheSportsDbSource] HTTP ${res.status} for ${path} (${elapsed}ms)`,
      );
      throw new Error(`thesportsdb HTTP ${res.status}: ${path}`);
    }
    console.log(`[TheSportsDbSource] GET ${path} → ${res.status} (${elapsed}ms)`);
    return res.json() as Promise<T>;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type TaggedEvent = SDBEvent & { _subTournamentKey?: string };

interface TournamentTagResult {
  events: TaggedEvent[];
  subTournaments: SubTournamentInfo[];
  activeSubTournamentKey: string | undefined;
}

/**
 * Detects the Argentine-style split tournament pattern (Clausura H1 + Apertura H2)
 * and tags each event with its sub-tournament key instead of discarding the inactive half.
 *
 * TheSportsDB stores both halves under the same league/season/round numbers.
 * eventsround.php returns ~30 events per round (15 Clausura + 15 Apertura).
 *
 * Detection: if ≥15% of events fall in each calendar half, the season is bimodal.
 * Each event is tagged with 'CLAUSURA' (Jan–Jun) or 'APERTURA' (Jul–Dec).
 * The active sub-tournament is determined by today's date.
 *
 * Single-window leagues (e.g. Uruguay) are not affected: all events are returned
 * untagged with no sub-tournament metadata.
 */
function tagTournamentHalves(
  events: SDBEvent[],
  season: string,
  knownDefs?: SubTournamentDef[],
): TournamentTagResult {
  if (events.length < 4) {
    return { events, subTournaments: [], activeSubTournamentKey: undefined };
  }

  const splitDate = `${season}-07-01`;
  const today = new Date().toISOString().slice(0, 10);
  const todayIsH1 = today < splitDate;

  // ── Explicit config path (bypasses bimodal detection) ─────────────────────
  if (knownDefs && knownDefs.length >= 2) {
    const h1Def = knownDefs.find((d) => d.isH1);
    const h2Def = knownDefs.find((d) => !d.isH1);
    if (!h1Def || !h2Def) {
      return { events, subTournaments: [], activeSubTournamentKey: undefined };
    }

    const activeKey = todayIsH1 ? h1Def.key : h2Def.key;
    const tagged: TaggedEvent[] = events.map((e) => ({
      ...e,
      _subTournamentKey: e.dateEvent && e.dateEvent < splitDate ? h1Def.key : h2Def.key,
    }));

    const cutoff60 = (() => { const d = new Date(today); d.setDate(d.getDate() + 60); return d.toISOString().slice(0, 10); })();
    const h1Events = tagged.filter((e) => e._subTournamentKey === h1Def.key);
    const h2Events = tagged.filter((e) => e._subTournamentKey === h2Def.key);
    const h1HasData = h1Events.some((e) => e.dateEvent && e.dateEvent <= cutoff60);
    const h2HasData = h2Events.some((e) => e.dateEvent && e.dateEvent <= cutoff60);

    const subTournaments: SubTournamentInfo[] = [
      { key: h1Def.key, label: h1Def.label, isActive: activeKey === h1Def.key, hasData: h1HasData },
      { key: h2Def.key, label: h2Def.label, isActive: activeKey === h2Def.key, hasData: h2HasData },
    ];

    console.log(
      `[TheSportsDbSource] Configured split — ${h1Def.key}:${h1Events.length}(hasData=${h1HasData}) + ${h2Def.key}:${h2Events.length}(hasData=${h2HasData}). Active: ${activeKey}`,
    );

    return { events: tagged, subTournaments, activeSubTournamentKey: activeKey };
  }

  // ── Auto-detection path (bimodal heuristic) ────────────────────────────────
  const firstHalf  = events.filter((e) => !!e.dateEvent && e.dateEvent <  splitDate);
  const secondHalf = events.filter((e) => !!e.dateEvent && e.dateEvent >= splitDate);

  const total = firstHalf.length + secondHalf.length;
  const MIN_FRACTION = 0.15;
  if (
    firstHalf.length  < total * MIN_FRACTION ||
    secondHalf.length < total * MIN_FRACTION
  ) {
    // Single-window season — no sub-tournament split
    return { events, subTournaments: [], activeSubTournamentKey: undefined };
  }

  // Argentine calendar: H1=Apertura (Jan-Jun), H2=Clausura (Jul-Dec)
  const activeKey = todayIsH1 ? 'APERTURA' : 'CLAUSURA';

  const tagged: TaggedEvent[] = events.map((e) => ({
    ...e,
    _subTournamentKey:
      e.dateEvent && e.dateEvent < splitDate ? 'APERTURA' : 'CLAUSURA',
  }));

  const cutoff60 = (() => { const d = new Date(today); d.setDate(d.getDate() + 60); return d.toISOString().slice(0, 10); })();
  const aperturaHasData = firstHalf.some((e) => e.dateEvent && e.dateEvent <= cutoff60);
  const clausuraHasData = secondHalf.some((e) => e.dateEvent && e.dateEvent <= cutoff60);

  const subTournaments: SubTournamentInfo[] = [
    { key: 'APERTURA', label: 'Apertura', isActive: activeKey === 'APERTURA', hasData: aperturaHasData },
    { key: 'CLAUSURA', label: 'Clausura', isActive: activeKey === 'CLAUSURA', hasData: clausuraHasData },
  ];

  console.log(
    `[TheSportsDbSource] Auto-detected split — APERTURA:${firstHalf.length}(hasData=${aperturaHasData}) + CLAUSURA:${secondHalf.length}(hasData=${clausuraHasData}). Active: ${activeKey}`,
  );

  return { events: tagged, subTournaments, activeSubTournamentKey: activeKey };
}

/**
 * Returns the "current" matchday based on match dates and statuses:
 *   1. Lowest round with a started (kickoff passed) but not-yet-FINISHED match — in progress.
 *   2. Highest round where ALL matches are FINISHED — most recently completed.
 *   3. Lowest round with a purely future match — fallback when everything is FINISHED.
 *
 * This avoids returning a future round when the most recently played round is the relevant one.
 * TheSportsDB often keeps matches as SCHEDULED even after kickoff, so we rely on
 * startTimeUtc to distinguish "in progress" from "truly upcoming".
 */
function deriveCurrentMatchday(matches: Match[]): number | undefined {
  const todayUtc = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  let minStarted: number | undefined;  // lowest round with a match on today's date or earlier (not terminal)
  let minFuture: number | undefined;   // lowest round with a purely future match
  let maxFinished: number | undefined; // highest round with only terminal matches

  for (const m of matches) {
    if (m.matchday === undefined) continue;
    // Treat POSTPONED/CANCELED as terminal (like FINISHED) — don't bucket by date
    const isTerminal = m.status === 'FINISHED' || m.status === 'POSTPONED' || m.status === 'CANCELED';
    if (isTerminal) {
      if (maxFinished === undefined || m.matchday > maxFinished) maxFinished = m.matchday;
    } else {
      // Compare by DATE only (not time) so today's evening matches count as "current"
      const matchDate = m.startTimeUtc?.slice(0, 10);
      if (matchDate && matchDate <= todayUtc) {
        // Today's or past-date match — this round is active/current
        if (minStarted === undefined || m.matchday < minStarted) minStarted = m.matchday;
      } else {
        // Future date (or no date info)
        if (minFuture === undefined || m.matchday < minFuture) minFuture = m.matchday;
      }
    }
  }

  // Priority: round with today's matches > last terminal round > first future round
  return minStarted ?? maxFinished ?? minFuture;
}

/** Compute standings from FINISHED matches (used when provider doesn't supply a table). */
function computeStandings(matches: Match[], teams: Team[]): StandingEntry[] {
  const teamMap = new Map<string, Team>(teams.map((t) => [t.teamId, t]));

  interface Row {
    teamId: string;
    played: number;
    won: number;
    draw: number;
    lost: number;
    gf: number;
    ga: number;
  }

  const rows = new Map<string, Row>();

  const getRow = (teamId: string): Row => {
    if (!rows.has(teamId)) {
      rows.set(teamId, { teamId, played: 0, won: 0, draw: 0, lost: 0, gf: 0, ga: 0 });
    }
    return rows.get(teamId)!;
  };

  for (const m of matches) {
    if (m.status !== 'FINISHED') continue;
    if (m.scoreHome === null || m.scoreAway === null) continue;

    const home = getRow(m.homeTeamId);
    const away = getRow(m.awayTeamId);

    home.played++;
    away.played++;
    home.gf += m.scoreHome;
    home.ga += m.scoreAway;
    away.gf += m.scoreAway;
    away.ga += m.scoreHome;

    if (m.scoreHome > m.scoreAway) {
      home.won++;
      away.lost++;
    } else if (m.scoreHome < m.scoreAway) {
      away.won++;
      home.lost++;
    } else {
      home.draw++;
      away.draw++;
    }
  }

  const sorted = [...rows.values()].sort((a, b) => {
    const ptsDiff = (b.won * 3 + b.draw) - (a.won * 3 + a.draw);
    if (ptsDiff !== 0) return ptsDiff;
    const gdDiff = (b.gf - b.ga) - (a.gf - a.ga);
    if (gdDiff !== 0) return gdDiff;
    const gfDiff = b.gf - a.gf;
    if (gfDiff !== 0) return gfDiff;
    return a.teamId.localeCompare(b.teamId);
  });

  return sorted.map((r, i) => {
    const team = teamMap.get(r.teamId);
    const gd = r.gf - r.ga;
    return {
      position: i + 1,
      teamId: r.teamId,
      teamName: resolveDisplayName(team?.name ?? r.teamId),
      tla: team?.tla ?? resolveTla(team?.name ?? r.teamId),
      crestUrl: team?.crestUrl,
      playedGames: r.played,
      won: r.won,
      draw: r.draw,
      lost: r.lost,
      goalsFor: r.gf,
      goalsAgainst: r.ga,
      goalDifference: gd,
      points: r.won * 3 + r.draw,
    };
  });
}

/** Highest matchday where ALL matches have status FINISHED. */
function computeLastPlayedMatchday(matches: Match[]): number | undefined {
  const stats = new Map<number, { total: number; finished: number }>();
  for (const m of matches) {
    if (m.matchday === undefined) continue;
    const s = stats.get(m.matchday) ?? { total: 0, finished: 0 };
    s.total++;
    if (m.status === 'FINISHED') s.finished++;
    stats.set(m.matchday, s);
  }
  let last: number | undefined;
  for (const [md, s] of stats) {
    if (s.total > 0 && s.finished === s.total) {
      if (last === undefined || md > last) last = md;
    }
  }
  return last;
}
