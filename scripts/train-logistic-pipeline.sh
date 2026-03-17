#!/usr/bin/env bash
# train-logistic-pipeline.sh — Pipeline completo de entrenamiento del modelo logístico.
#
# Pasos:
#   1. build-odds-dataset   — Descarga CSVs de football-data.co.uk → cache/odds-data/
#   2. train-logistic       — Walk-forward + class weights → cache/logistic-coefficients.json
#   3. backtest-v3 baseline — Evalúa Poisson puro (sin ensemble)
#   4. backtest-v3 ensemble — Evalúa Poisson + Logistic + market odds
#
# Uso:
#   bash scripts/train-logistic-pipeline.sh
#   bash scripts/train-logistic-pipeline.sh --skip-download   # si odds ya están en cache
#   bash scripts/train-logistic-pipeline.sh --no-backtest     # solo entrena, no evalúa

set -e

SKIP_DOWNLOAD=false
NO_BACKTEST=false

for arg in "$@"; do
  case $arg in
    --skip-download) SKIP_DOWNLOAD=true ;;
    --no-backtest)   NO_BACKTEST=true ;;
  esac
done

TSX="npx tsx --tsconfig tsconfig.server.json"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  SportPulse — Logistic Model Training Pipeline               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── Paso 1: Descargar odds ────────────────────────────────────────────────────
if [ "$SKIP_DOWNLOAD" = false ]; then
  echo "▶ Paso 1/4 — Descargando odds históricas (football-data.co.uk)..."
  $TSX tools/build-odds-dataset.ts
  echo ""
else
  echo "▶ Paso 1/4 — Descarga omitida (--skip-download)"
  echo ""
fi

# ── Paso 2: Entrenar modelo logístico ────────────────────────────────────────
echo "▶ Paso 2/4 — Entrenando modelo logístico multinomial..."
$TSX tools/train-logistic.ts "$@"
echo ""

if [ "$NO_BACKTEST" = true ]; then
  echo "▶ Pasos 3-4 omitidos (--no-backtest)"
  echo ""
  echo "✓ Entrenamiento completado. Coeficientes en cache/logistic-coefficients.json"
  exit 0
fi

# ── Paso 3: Backtest baseline (Poisson puro) ─────────────────────────────────
echo "▶ Paso 3/4 — Backtest baseline (Poisson puro)..."
$TSX tools/backtest-v3.ts
echo ""

# ── Paso 4: Backtest ensemble (Poisson + Logistic + Market Odds) ─────────────
echo "▶ Paso 4/4 — Backtest ensemble (Poisson + Logistic + Market Odds)..."
$TSX tools/backtest-v3.ts --ensemble
echo ""

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Pipeline completado.                                        ║"
echo "║  Coeficientes: cache/logistic-coefficients.json             ║"
echo "╚══════════════════════════════════════════════════════════════╝"
