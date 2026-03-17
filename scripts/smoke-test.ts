#!/usr/bin/env tsx
/**
 * smoke-test.ts — Post-deploy smoke test
 * Usage: SMOKE_BASE_URL=https://your-app.onrender.com pnpm smoke-test
 *        pnpm smoke-test  (tests localhost:3000)
 */

const BASE_URL = (process.env.SMOKE_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
let failed = 0;

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err: unknown) {
    console.error(`  ✗ ${name}: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function main(): Promise<void> {
  console.log(`\n🔍 Smoke test → ${BASE_URL}\n`);

  // 1. Portal config
  let enabledIds: string[] = [];
  await check('portal-config responds with competitions', async () => {
    const cfg = await get<{ competitions?: Array<{ id: string; enabled: boolean }> }>('/api/ui/portal-config');
    if (!cfg.competitions?.length) throw new Error('no competitions in response');
    enabledIds = cfg.competitions.filter(c => c.enabled).map(c => c.id);
    if (!enabledIds.length) throw new Error('no enabled competitions');
  });

  // 2. Status endpoint — routing parity
  await check('status: all competitions loaded', async () => {
    const status = await get<{ allLoaded?: boolean; competitions?: Record<string, { loaded: boolean }> }>('/api/ui/status');
    if (status.allLoaded === false) {
      const unloaded = Object.entries(status.competitions ?? {})
        .filter(([, v]) => !v.loaded)
        .map(([id]) => id);
      throw new Error(`unloaded: ${unloaded.join(', ')}`);
    }
  });

  // 3. Dashboard for each enabled competition
  for (const id of enabledIds) {
    await check(`dashboard: ${id}`, async () => {
      const snap = await get<unknown>(`/api/ui/dashboard?competitionId=${encodeURIComponent(id)}&timezone=America%2FMontevideo`);
      if (!snap) throw new Error('null response');
    });
  }

  // 4. News (one league)
  await check('news endpoint responds', async () => {
    await get('/api/ui/news?league=PD');
  });

  // Summary
  const icon = failed === 0 ? '✅' : '❌';
  console.log(`\n${icon} ${failed === 0 ? 'All smoke checks passed' : `${failed} check(s) FAILED`}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
