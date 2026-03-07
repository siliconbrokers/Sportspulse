#!/usr/bin/env bash
# Reinicia el dev server limpiamente.
# Mata todos los procesos relevantes, verifica que los puertos estén libres, luego inicia.
set -e

echo "[dev-restart] Matando procesos anteriores..."

# Matar por puerto (explícito)
for PORT in 3000 5173 5174 5175; do
  PIDS=$(lsof -ti :$PORT 2>/dev/null) || true
  if [ -n "$PIDS" ]; then
    echo "  kill :$PORT → PIDs $PIDS"
    kill -9 $PIDS 2>/dev/null || true
  fi
done

# Matar por nombre de proceso
pkill -9 -f "tsx.*server" 2>/dev/null || true
pkill -9 -f "tsx.*index" 2>/dev/null || true
pkill -9 -f "vite" 2>/dev/null || true

echo "[dev-restart] Esperando que los puertos queden libres..."
sleep 3

# Verificar que 3000 y 5173 estén libres
for PORT in 3000 5173; do
  if lsof -ti :$PORT > /dev/null 2>&1; then
    echo "[dev-restart] ERROR: puerto $PORT sigue ocupado. Abortando."
    lsof -ti :$PORT | xargs kill -9 2>/dev/null || true
    sleep 2
  fi
done

echo "[dev-restart] Puertos libres. Iniciando dev servers..."
pnpm dev
