/**
 * af-shadow-runner.ts — Runner de validación sombra AF vs FD por liga.
 *
 * Activación: env SHADOW_AF_VALIDATION_ENABLED=true
 *
 * Para cada liga FD habilitada:
 *   1. Carga historial FD via HistoricalStateService (ya cacheado en disco)
 *   2. Construye canonicalNameMap desde dataSource.getTeams()
 *   3. Llama runShadowValidation → buildTeamBridge + loadAfHistoricalMatches + compare
 *   4. Logea el resultado (PASS / WARN / FAIL) en console — no bloquea el refresh
 *
 * Fault isolated: cualquier error en una liga no afecta las demás ni el servidor.
 */

import type { DataSource }         from '@sportpulse/snapshot';
import { normTeamName }            from './injury-source.js';
import { runShadowValidation }     from './shadow-validator.js';
import type { HistoricalStateService } from './historical-state-service.js';

// ── Mapping FD competition IDs → AF league IDs ───────────────────────────────

const AF_LEAGUE_IDS: Record<string, number> = {
  'comp:football-data:PD': 140, // LaLiga
  'comp:football-data:PL':  39, // Premier League
  'comp:football-data:BL1': 78, // Bundesliga (FD code BL1; runtime comp is openligadb:bl1)
};

// Map FD competition ID → FD competition code (for HistoricalStateService)
const FD_COMP_CODE: Record<string, string> = {
  'comp:football-data:PD':  'PD',
  'comp:football-data:PL':  'PL',
  'comp:football-data:BL1': 'BL1',
};

// ── Runner ────────────────────────────────────────────────────────────────────

/**
 * Ejecuta validación sombra AF vs FD para las competencias especificadas.
 *
 * @param dataSource              DataSource canónico (para getTeams)
 * @param fdCompetitionIds        Lista de competitionIds de FD a validar (e.g. ['comp:football-data:PD'])
 * @param historicalStateService  HistoricalStateService ya instanciado (comparte cache con predictor)
 * @param seasonYear              Año de inicio de la temporada actual
 * @param apiKey                  APIFOOTBALL_KEY
 */
export async function runAfShadowValidation(
  dataSource:             DataSource,
  fdCompetitionIds:       string[],
  historicalStateService: HistoricalStateService,
  seasonYear:             number,
  apiKey:                 string,
): Promise<void> {
  if (!apiKey) {
    console.log('[AfShadowRunner] APIFOOTBALL_KEY not set — skipping AF shadow validation');
    return;
  }

  const enabled = fdCompetitionIds.filter((id) => AF_LEAGUE_IDS[id] !== undefined);

  if (enabled.length === 0) {
    console.log('[AfShadowRunner] No FD competitions mapped to AF league IDs — skipping');
    return;
  }

  console.log(`[AfShadowRunner] Starting AF shadow validation for ${enabled.length} leagues (season=${seasonYear})`);

  const results: Array<{ competitionId: string; verdict: string }> = [];

  for (const competitionId of enabled) {
    const leagueId = AF_LEAGUE_IDS[competitionId];
    const fdCode   = FD_COMP_CODE[competitionId];

    try {
      // Step 1: get FD historical records (shared cache — no extra cost)
      const fdRecords = await historicalStateService.getAllMatches(fdCode, seasonYear);

      if (fdRecords.length === 0) {
        console.log(`[AfShadowRunner] ${competitionId}: no FD records — skipping`);
        continue;
      }

      // Step 2: build canonicalNameMap from dataSource teams
      const teams = dataSource.getTeams(competitionId);
      const canonicalNameMap = new Map<string, string>();
      for (const team of teams) {
        canonicalNameMap.set(normTeamName(team.name), team.teamId);
        if (team.shortName) {
          canonicalNameMap.set(normTeamName(team.shortName), team.teamId);
        }
      }

      // Step 3: run shadow validation
      const report = await runShadowValidation({
        leagueId,
        currentSeason: seasonYear,
        apiKey,
        canonicalNameMap,
        fdRecords,
      });

      if (!report) {
        console.warn(`[AfShadowRunner] ${competitionId}: shadow validation returned null`);
        results.push({ competitionId, verdict: 'ERROR' });
        continue;
      }

      results.push({ competitionId, verdict: report.verdict });

    } catch (err) {
      console.error(`[AfShadowRunner] ${competitionId}: unexpected error:`, err);
      results.push({ competitionId, verdict: 'ERROR' });
    }
  }

  // Summary log
  const summary = results.map((r) => `${r.competitionId.split(':').pop()}=${r.verdict}`).join(' | ');
  console.log(`[AfShadowRunner] Done — ${summary}`);
}
