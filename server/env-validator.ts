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
  { name: 'APIFOOTBALL_KEY',     required: false, description: 'API-Football v3 key — canonical source + live overlay + incidents (incidents/overlay disabled if missing)' },
  { name: 'PORT',                required: false, description: 'HTTP port (default: 3000)' },
  { name: 'COMPETITIONS',        required: false, description: 'Comma-separated league codes (default: PD)' },
  { name: 'SPORTSDB_API_KEY',    required: false, description: 'TheSportsDB key (default: 123 free tier)' },
  { name: 'YOUTUBE_API_KEY',     required: false, description: 'YouTube Data API v3 — video highlights disabled if missing' },
  { name: 'ADMIN_SECRET',        required: false, description: 'Admin panel password — /admin route disabled if missing' },
  { name: 'NEXUS_SHADOW_ENABLED', required: false, description: 'Comma-separated competition IDs for NEXUS (PE v2) shadow predictions — disabled if missing (master spec §S8.2)' },
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

  // Phase 12 conditional validation — V2 routes
  const v2Active = (process.env['ENABLE_V2_ROUTES'] ?? '').toLowerCase() === 'true';
  if (v2Active) {
    const v2Required = ['DATABASE_URL', 'APP_BASE_URL'];
    const v2Missing = v2Required.filter(name => {
      const val = process.env[name];
      return !val || val.trim() === '';
    });
    if (v2Missing.length > 0) {
      console.error('[EnvValidator] V2_ROUTES active but missing required vars:');
      for (const name of v2Missing) console.error(`  ${name}`);
      throw new Error(`[EnvValidator] ${v2Missing.length} required V2 env var(s) missing — aborting startup`);
    }
    // Advisory warnings for vars that use dev adapters when absent
    const v2Advisory = ['RESEND_API_KEY', 'EMAIL_FROM', 'STRIPE_SECRET_KEY'];
    for (const name of v2Advisory) {
      const val = process.env[name];
      if (!val || val.trim() === '') {
        console.warn(`[EnvValidator] WARNING: ${name} not set — using dev adapter (log-sink/mock)`);
      }
    }
    console.log('[EnvValidator] V2 routes active — required vars present ✓');
  }
}
