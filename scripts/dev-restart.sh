#!/usr/bin/env bash
# dev-restart.sh — arranque secuencial: API primero, luego frontend
# Evita OOM causado por concurrently al arrancar ambos simultáneamente

set -euo pipefail

# ── 1. Limpiar procesos y puertos previos ─────────────────────────────────────
echo "[dev-restart] Limpiando procesos anteriores..."

for PORT in 3000 5173 5174 5175; do
  PIDS=$(lsof -ti :$PORT 2>/dev/null) || true
  if [ -n "$PIDS" ]; then
    echo "  kill :$PORT → PIDs $PIDS"
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
  fi
done

pkill -9 -f "tsx.*server" 2>/dev/null || true
pkill -9 -f "tsx.*index"  2>/dev/null || true
pkill -9 -f "vite"        2>/dev/null || true

sleep 2

# ── 2. Verificar puertos libres ───────────────────────────────────────────────
for PORT in 3000 5173; do
  if lsof -ti :$PORT > /dev/null 2>&1; then
    echo "[dev-restart] WARN: puerto $PORT sigue ocupado, forzando kill..."
    lsof -ti :$PORT | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
done

# ── 3. Arrancar API (con límite de heap para evitar OOM) ─────────────────────
echo "[dev-restart] Arrancando API..."
NODE_OPTIONS="--max-old-space-size=1024" \
  npx dotenv-cli -e .env -- \
  npx tsx --tsconfig tsconfig.server.json server/index.ts \
  >> /tmp/sp-api.log 2>&1 &
API_PID=$!
echo "[dev-restart] API PID: $API_PID"

# ── 4. Esperar a que API esté lista (poll :3000, máx 120s) ───────────────────
echo "[dev-restart] Esperando API en :3000..."
MAX_WAIT=120
WAITED=0
until lsof -ti :3000 > /dev/null 2>&1; do
  if ! kill -0 $API_PID 2>/dev/null; then
    echo "[dev-restart] ERROR: API murió durante el arranque. Ver /tmp/sp-api.log"
    tail -20 /tmp/sp-api.log
    exit 1
  fi
  sleep 3
  WAITED=$((WAITED + 3))
  if [ $WAITED -ge $MAX_WAIT ]; then
    echo "[dev-restart] ERROR: API no respondió en ${MAX_WAIT}s"
    tail -20 /tmp/sp-api.log
    exit 1
  fi
  echo "  ...API iniciando ($WAITED/${MAX_WAIT}s)"
done
echo "[dev-restart] ✅ API lista en :3000"

# ── 5. Arrancar frontend ──────────────────────────────────────────────────────
echo "[dev-restart] Arrancando frontend..."
pnpm --filter @sportpulse/web dev >> /tmp/sp-web.log 2>&1 &
WEB_PID=$!

# Esperar a que Vite levante (hasta 20s)
WAITED=0
until lsof -ti :5173 > /dev/null 2>&1; do
  sleep 2
  WAITED=$((WAITED + 2))
  if [ $WAITED -ge 20 ]; then
    echo "[dev-restart] WARN: Frontend tardando más de lo esperado en :5173"
    break
  fi
done

if lsof -ti :5173 > /dev/null 2>&1; then
  echo "[dev-restart] ✅ Frontend listo en :5173"
fi

# ── 6. Resumen ────────────────────────────────────────────────────────────────
echo ""
echo "========================================"
echo "  API      → http://localhost:3000"
echo "  Frontend → http://localhost:5173"
echo "  API PID  : $API_PID"
echo "  Web PID  : $WEB_PID"
echo "  Logs API : tail -f /tmp/sp-api.log"
echo "  Logs Web : tail -f /tmp/sp-web.log"
echo "========================================"
