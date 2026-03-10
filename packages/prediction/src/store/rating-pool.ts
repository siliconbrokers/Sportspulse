/**
 * Rating Pool — §10.1 Separación obligatoria de pools
 *
 * Two strictly separate pools: ClubRatingPool and NationalTeamRatingPool.
 * It is FORBIDDEN to share ratings between clubs and national teams.
 *
 * Spec §10.1: "Queda prohibido compartir directamente el mismo universo de
 * rating entre clubes y selecciones."
 *
 * These are pure in-memory value stores. They have no IO, no side effects,
 * and are deterministic given the same sequence of mutations.
 */

// ── Constants ─────────────────────────────────────────────────────────────

/**
 * Default Elo rating assigned to a team with no history.
 * Minimal safe assumption: 1500 is the standard Elo origin.
 * Spec §20.1: "debe existir una política explícita para rating inicial por dominio"
 */
export const DEFAULT_ELO_RATING: number = 1500;

// ── Types ─────────────────────────────────────────────────────────────────

/**
 * A single team's rating record in a pool.
 */
export interface TeamRatingRecord {
  /** Canonical team identifier. */
  readonly teamId: string;
  /** Current Elo rating value. Always a finite number. */
  rating: number;
  /**
   * Number of rating update events applied to this record.
   * Used to determine LIMITED_MODE degradation per §20.1.
   */
  updateCount: number;
  /** ISO-8601 UTC timestamp of the last update event. */
  lastUpdatedUtc: string | null;
}

/**
 * Read-only view of a team rating record (for external consumers).
 */
export type TeamRatingSnapshot = Readonly<TeamRatingRecord>;

// ── Rating Pool interface ─────────────────────────────────────────────────

/**
 * Interface for a typed rating pool (club or national team).
 * §10.1 — each domain must have its own pool instance.
 */
export interface RatingPool {
  /**
   * Get the rating record for a team.
   * Returns the record if it exists, or null if the team has no entry.
   */
  get(teamId: string): TeamRatingSnapshot | null;

  /**
   * Get the effective rating for a team, falling back to DEFAULT_ELO_RATING
   * if the team has no record. This never throws.
   * §20.1: new team policy — use default when no history.
   */
  getOrDefault(teamId: string): number;

  /**
   * Set or replace a team's rating record.
   * Pure mutation — no IO.
   */
  set(record: TeamRatingRecord): void;

  /**
   * Initialize a team with the default rating if it does not yet exist.
   * No-op if the team already has a record.
   * Returns the (possibly new) rating record.
   * §20.1: "equipos debutantes o con historia insuficiente"
   */
  initializeIfAbsent(teamId: string, atUtc: string): TeamRatingRecord;

  /**
   * Apply a rating delta to an existing record (or initialize first).
   * Returns the updated record.
   */
  applyDelta(teamId: string, delta: number, atUtc: string): TeamRatingRecord;

  /**
   * Return all team IDs in this pool. Deterministic ordering (sorted).
   */
  allTeamIds(): readonly string[];

  /**
   * Return the total number of teams in this pool.
   */
  size(): number;
}

// ── Internal implementation ───────────────────────────────────────────────

/**
 * In-memory implementation of RatingPool.
 * State is stored in a plain Map — no hidden globals, fully replaceable.
 */
class InMemoryRatingPool implements RatingPool {
  private readonly _records: Map<string, TeamRatingRecord> = new Map();

  get(teamId: string): TeamRatingSnapshot | null {
    return this._records.get(teamId) ?? null;
  }

  getOrDefault(teamId: string): number {
    return this._records.get(teamId)?.rating ?? DEFAULT_ELO_RATING;
  }

  set(record: TeamRatingRecord): void {
    // Store a shallow copy to prevent mutation from outside.
    this._records.set(record.teamId, { ...record });
  }

  initializeIfAbsent(teamId: string, atUtc: string): TeamRatingRecord {
    if (!this._records.has(teamId)) {
      const newRecord: TeamRatingRecord = {
        teamId,
        rating: DEFAULT_ELO_RATING,
        updateCount: 0,
        lastUpdatedUtc: atUtc,
      };
      this._records.set(teamId, newRecord);
    }
    return { ...this._records.get(teamId)! };
  }

  applyDelta(teamId: string, delta: number, atUtc: string): TeamRatingRecord {
    const existing = this._records.get(teamId);
    const current = existing ?? {
      teamId,
      rating: DEFAULT_ELO_RATING,
      updateCount: 0,
      lastUpdatedUtc: null,
    };
    const updated: TeamRatingRecord = {
      teamId,
      rating: current.rating + delta,
      updateCount: current.updateCount + 1,
      lastUpdatedUtc: atUtc,
    };
    this._records.set(teamId, updated);
    return { ...updated };
  }

  allTeamIds(): readonly string[] {
    return Array.from(this._records.keys()).sort();
  }

  size(): number {
    return this._records.size;
  }
}

// ── Factory ───────────────────────────────────────────────────────────────

/**
 * Pool for CLUB domain ratings.
 * §10.1: "club_rating_pool" — must never contain national teams.
 *
 * Factory returns a fresh pool. Callers are responsible for managing
 * pool lifecycle — no global singleton state here.
 */
export function createClubRatingPool(): RatingPool {
  return new InMemoryRatingPool();
}

/**
 * Pool for NATIONAL_TEAM domain ratings.
 * §10.1: "national_team_rating_pool" — must never contain clubs.
 * §10.5: "se usa exclusivamente el pool de selecciones."
 *
 * Factory returns a fresh pool.
 */
export function createNationalTeamRatingPool(): RatingPool {
  return new InMemoryRatingPool();
}
