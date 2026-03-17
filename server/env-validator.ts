/**
 * env-validator.ts — Fail-fast validation of required environment variables.
 * Called at the very start of server/index.ts main() before any service initializes.
 */

interface EnvVarSpec {
  name: string;
  required: boolean;
  description: string;
}

const ENV_SPEC: EnvVarSpec[] = [
  { name: 'FOOTBALL_DATA_TOKEN', required: true,  description: 'football-data.org API token — league data source' },
  { name: 'APIFOOTBALL_KEY',     required: true,  description: 'API-Football v3 key — canonical source + live overlay + incidents' },
  { name: 'PORT',                required: false, description: 'HTTP port (default: 3000)' },
  { name: 'COMPETITIONS',        required: false, description: 'Comma-separated league codes (default: PD)' },
  { name: 'SPORTSDB_API_KEY',    required: false, description: 'TheSportsDB key (default: 123 free tier)' },
  { name: 'YOUTUBE_API_KEY',     required: false, description: 'YouTube Data API v3 — video highlights disabled if missing' },
  { name: 'ADMIN_SECRET',        required: false, description: 'Admin panel password — /admin route disabled if missing' },
];

export function validateEnv(): void {
  const missing: string[] = [];
  for (const spec of ENV_SPEC) {
    const val = process.env[spec.name];
    if (spec.required && (!val || val.trim() === '')) {
      missing.push(`  ${spec.name}: ${spec.description}`);
    }
  }
  if (missing.length > 0) {
    console.error('[EnvValidator] MISSING REQUIRED ENVIRONMENT VARIABLES:');
    for (const m of missing) console.error(m);
    console.error('[EnvValidator] Set these in Render Dashboard → Environment, or in .env file for local dev.');
    throw new Error(`[EnvValidator] ${missing.length} required env var(s) missing — aborting startup`);
  }
  console.log(`[EnvValidator] All required env vars present ✓`);
}
