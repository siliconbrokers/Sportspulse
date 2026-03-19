/**
 * OpsApiUsagePage — Ops dashboard for API quota monitoring.
 * Route: /admin/ops
 * Auth: reads token from sessionStorage key 'admin_token' (same key as AdminPage).
 * Styles: CSS-in-JS with sp-* variables (no Tailwind).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from '../hooks/use-theme.js';
import { ThemeToggle } from '../components/ThemeToggle.js';
import { ProviderSummaryGrid } from './ProviderSummaryGrid.js';
import { ProviderDetailPanel } from './ProviderDetailPanel.js';
import { ApiEventsTable } from './ApiEventsTable.js';
import {
  fetchApiUsageToday,
  fetchProviderDetail,
} from '../hooks/use-api-usage.js';
import type { TodayResponse, ProviderDetailResponse } from '../hooks/use-api-usage.js';

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  page: {
    minHeight: '100vh',
    background: 'var(--sp-bg)',
    color: 'var(--sp-text)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    padding: '28px 20px 48px',
  } as React.CSSProperties,
  inner: {
    maxWidth: 1100,
    margin: '0 auto',
  } as React.CSSProperties,
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap' as const,
    gap: 10,
    marginBottom: 24,
  } as React.CSSProperties,
  title: {
    fontSize: 18,
    fontWeight: 700,
    color: 'var(--sp-text)',
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: 'var(--sp-text-40)',
    marginBottom: 12,
    marginTop: 28,
  } as React.CSSProperties,
};

// ─── Restricted screen ───────────────────────────────────────────────────────

function RestrictedScreen() {
  return (
    <div style={S.page}>
      <div
        style={{
          maxWidth: 480,
          margin: '80px auto',
          textAlign: 'center',
          color: 'var(--sp-text-40)',
          fontSize: 14,
          lineHeight: 1.6,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--sp-text)', marginBottom: 8 }}>
          Acceso restringido
        </div>
        Debes autenticarte primero.{' '}
        <a href="/admin" style={{ color: 'var(--sp-primary)', textDecoration: 'none', fontWeight: 600 }}>
          Ir a /admin
        </a>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function OpsApiUsagePage() {
  const token = sessionStorage.getItem('admin_token');

  if (!token) {
    return <RestrictedScreen />;
  }

  return <OpsInner token={token} />;
}

// ─── Inner (only rendered when token exists) ─────────────────────────────────

function OpsInner({ token }: { token: string }) {
  const { theme, toggleTheme } = useTheme();
  const [todayData, setTodayData] = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<ProviderDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch /today ──────────────────────────────────────────────────────────

  const loadToday = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApiUsageToday(token);
      setTodayData(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al cargar datos');
    } finally {
      setLoading(false);
    }
  }, [token]);

  // ── Fetch provider detail ─────────────────────────────────────────────────

  const loadDetail = useCallback(async (key: string) => {
    setDetailLoading(true);
    setDetailData(null);
    try {
      const data = await fetchProviderDetail(token, key);
      setDetailData(data);
    } catch {
      setDetailData(null);
    } finally {
      setDetailLoading(false);
    }
  }, [token]);

  // ── Initial load ──────────────────────────────────────────────────────────

  useEffect(() => {
    void loadToday();
  }, [loadToday]);

  // ── Re-fetch detail when provider selection changes ───────────────────────

  useEffect(() => {
    if (selectedProvider) {
      void loadDetail(selectedProvider);
    } else {
      setDetailData(null);
    }
  }, [selectedProvider, loadDetail]);

  // ── Auto-refresh toggle (30s) ─────────────────────────────────────────────

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        void loadToday();
        if (selectedProvider) void loadDetail(selectedProvider);
      }, 30_000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, loadToday, loadDetail, selectedProvider]);

  // ── Provider selection handler ────────────────────────────────────────────

  function handleSelectProvider(key: string) {
    setSelectedProvider((prev) => (prev === key ? null : key));
  }

  const providers = todayData?.providers ?? [];
  const knownProviders = providers.map((p) => p.providerKey);

  const selectedSummary = selectedProvider
    ? providers.find((p) => p.providerKey === selectedProvider) ?? null
    : null;

  return (
    <div style={S.page}>
      <div style={S.inner}>
        {/* ── Page header ── */}
        <div style={S.header}>
          <div>
            <div style={S.title}>API Usage — Ops</div>
            {todayData && (
              <div style={{ fontSize: 11, color: 'var(--sp-text-40)', marginTop: 3 }}>
                Fecha: <strong style={{ color: 'var(--sp-text)' }}>{todayData.date}</strong>
                {' · '}
                Generado:{' '}
                {new Date(todayData.generatedAtUtc).toLocaleTimeString('es-UY', {
                  timeZone: 'America/Montevideo',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {/* Manual refresh */}
            <button
              onClick={() => { void loadToday(); if (selectedProvider) void loadDetail(selectedProvider); }}
              disabled={loading}
              style={{
                padding: '7px 14px',
                borderRadius: 6,
                border: '1px solid var(--sp-border-8)',
                background: 'var(--sp-surface)',
                color: 'var(--sp-text)',
                fontSize: 12,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1,
              }}
            >
              ↻ Refrescar
            </button>
            {/* Auto-refresh toggle */}
            <button
              onClick={() => setAutoRefresh((v) => !v)}
              style={{
                padding: '7px 14px',
                borderRadius: 6,
                border: 'none',
                background: autoRefresh ? 'var(--sp-primary)' : 'var(--sp-border-8)',
                color: autoRefresh ? '#fff' : 'var(--sp-text)',
                fontSize: 12,
                cursor: 'pointer',
                fontWeight: autoRefresh ? 700 : 400,
              }}
            >
              {autoRefresh ? '⏸ Auto-refresh ON (30s)' : '▶ Auto-refresh OFF'}
            </button>
            <a
              href="/admin"
              style={{ fontSize: 12, color: 'var(--sp-primary)', textDecoration: 'none', fontWeight: 600 }}
            >
              ← Back Office
            </a>
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div style={{ fontSize: 13, color: '#ef4444', marginBottom: 16 }}>
            Error: {error}
          </div>
        )}

        {/* ── Section 1: Provider summary grid ── */}
        <div style={S.sectionTitle}>Providers</div>
        <ProviderSummaryGrid
          providers={providers}
          selectedProvider={selectedProvider}
          onSelectProvider={handleSelectProvider}
          loading={loading}
        />

        {/* ── Section 2: Provider detail panel ── */}
        {selectedProvider && selectedSummary && (
          <ProviderDetailPanel
            providerKey={selectedProvider}
            displayName={selectedSummary.displayName}
            summaryItem={selectedSummary}
            detail={detailData}
            loading={detailLoading}
            onClose={() => setSelectedProvider(null)}
          />
        )}

        {/* ── Section 3: Events table ── */}
        <div style={S.sectionTitle}>Eventos recientes</div>
        <div
          style={{
            background: 'var(--sp-surface)',
            border: '1px solid var(--sp-border-8)',
            borderRadius: 10,
            padding: '16px 18px',
          }}
        >
          <ApiEventsTable token={token} knownProviders={knownProviders} />
        </div>
      </div>
    </div>
  );
}
