#!/usr/bin/env bash
# scripts/dev-restart.sh — Restart limpio de dev server (API + Vite)
# Mata procesos por puerto Y por nombre, espera confirmación, luego inicia.
set -euo pipefail

echo "⏹  Deteniendo procesos anteriores..."

# Matar por puerto
for PORT in 3000 5173 5174 5175; do
  PIDS=$(lsof -ti ":$PORT" 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "   kill :$PORT → PIDs $PIDS"
    kill -9 $PIDS 2>/dev/null || true
  fi
done

# Matar por nombre de proceso (backup)
pkill -f "tsx.*server/index" 2>/dev/null || true
pkill -f "vite"               2>/dev/null || true

# Esperar a que los puertos queden libres (máx 5s)
for i in $(seq 1 5); do
  ALL_FREE=true
  for PORT in 3000 5173; do
    if lsof -ti ":$PORT" &>/dev/null; then
      ALL_FREE=false
    fi
  done
  if $ALL_FREE; then break; fi
  echo "   esperando liberar puertos... ($i/5)"
  sleep 1
done

echo "▶  Iniciando pnpm dev..."
exec pnpm dev
