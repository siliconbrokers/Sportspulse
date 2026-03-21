#!/usr/bin/env bash
# pack-cache.sh — Empaqueta los datos de cache de dev para seed en producción.
# Genera un tarball base64 y proporciona el comando curl para subirlo.
#
# Uso:
#   pnpm pack-cache                                    # empaqueta + muestra instrucciones
#   SEED_URL=https://... pnpm pack-cache               # empaqueta + sube (skip archivos existentes)
#   ADMIN_SECRET=xxx SEED_URL=... pnpm pack-cache      # ídem con auth automático
#   OVERWRITE=true ADMIN_SECRET=xxx SEED_URL=... pnpm pack-cache  # fuerza sobreescritura

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CACHE_DIR="$REPO_ROOT/cache"
OUT_DIR="$REPO_ROOT/tmp"
TARBALL="$OUT_DIR/cache-seed.tar.gz"
B64_FILE="$OUT_DIR/cache-seed.b64"

# Directorios a incluir (críticos para que el servidor levante sin API calls)
INCLUDE_DIRS=(
  "apifootball"      # matchday data AF — CRÍTICO
  "football-data"    # matchday data FD (LaLiga/EPL/BUN) — CRÍTICO
  "af-team-bridge"   # mapeo de equipos AF
  "calibration"      # PE calibration data
  "nexus-models"     # NEXUS model
  "xg"               # xG histórico por fixture (evita backfill storm en prod) — CRÍTICO
  "historical"       # partidos históricos por temporada (training data PE) — CRÍTICO
  "injuries"         # injury cache por (leagueId/season/date) — evita storm en prod
  "player-stats"     # player stats cache por (season/playerId) — evita storm en prod
  "lineups"          # lineup cache por (leagueId/date y fixtureId) — evita refetch en restart
  "odds"             # AF odds cache por fixtureId — evita refetch en restart
  "events"           # eventos de gol por partido FINISHED (permanentes, inmutables)
  "predictions"      # PE predictions cache por modelo y competición
)

# Archivos sueltos a incluir
INCLUDE_FILES=(
  "portal-config.json"
  "logistic-coefficients.json"
)

echo "🔧 SportsPulse — Cache Seed Packager"
echo "======================================"
echo "Cache dir: $CACHE_DIR"
echo ""

# Validar que exista el directorio de cache
if [ ! -d "$CACHE_DIR" ]; then
  echo "❌ ERROR: No se encontró $CACHE_DIR"
  exit 1
fi

mkdir -p "$OUT_DIR"

# Construir lista de elementos a incluir (solo los que existen)
TAR_ARGS=()
for dir in "${INCLUDE_DIRS[@]}"; do
  if [ -d "$CACHE_DIR/$dir" ]; then
    TAR_ARGS+=("$dir")
    SIZE=$(du -sh "$CACHE_DIR/$dir" 2>/dev/null | cut -f1)
    echo "  ✅ $dir/ ($SIZE)"
  else
    echo "  ⚠️  $dir/ — no encontrado, omitido"
  fi
done
for file in "${INCLUDE_FILES[@]}"; do
  if [ -f "$CACHE_DIR/$file" ]; then
    TAR_ARGS+=("$file")
    SIZE=$(du -sh "$CACHE_DIR/$file" 2>/dev/null | cut -f1)
    echo "  ✅ $file ($SIZE)"
  else
    echo "  ⚠️  $file — no encontrado, omitido"
  fi
done

if [ ${#TAR_ARGS[@]} -eq 0 ]; then
  echo "❌ ERROR: No hay datos para empaquetar"
  exit 1
fi

echo ""
echo "📦 Creando tarball..."
(cd "$CACHE_DIR" && tar czf "$TARBALL" \
  --exclude='predictions/snapshots.json.bak' \
  --exclude='predictions/evaluations.backup-pre-v3fix.json' \
  --exclude='predictions/forward-validation.backup-pre-h11fix.json' \
  "${TAR_ARGS[@]}")

TARBALL_SIZE=$(du -sh "$TARBALL" | cut -f1)
echo "   → $TARBALL ($TARBALL_SIZE)"

echo "🔄 Codificando en base64..."
base64 < "$TARBALL" > "$B64_FILE"
B64_SIZE=$(wc -c < "$B64_FILE" | tr -d ' ')
echo "   → $B64_FILE (${B64_SIZE} bytes)"

# Construir payload JSON
PAYLOAD_FILE="$OUT_DIR/cache-seed-payload.json"
python3 -c "
import json, sys
with open('$B64_FILE') as f:
    data = f.read().strip()
import os
overwrite = os.environ.get('OVERWRITE', 'true').lower() == 'true'  # default: overwrite
# Archivos que producción genera por sí misma después del seed inicial.
# Se protegen en seeds subsiguientes: si ya existen en disco, prod mantiene su versión.
# Si no existen aún (primer seed), el tar los crea normalmente.
never_overwrite = [
  'predictions/snapshots.json',   # prod acumula predicciones live
  'predictions/evaluations.json', # prod acumula métricas de accuracy running
]
payload = {'data': data, 'overwrite': overwrite, 'neverOverwrite': never_overwrite}
with open('$PAYLOAD_FILE', 'w') as f:
    json.dump(payload, f)
print('   → $PAYLOAD_FILE')
"

echo ""
echo "======================================"
echo "📋 Instrucciones para subir a producción:"
echo ""

SEED_URL="${SEED_URL:-https://sportspulse-qc6r.onrender.com}"
SECRET="${ADMIN_SECRET:-<TU_ADMIN_SECRET>}"

echo "  curl -X POST \\"
echo "    -H 'Authorization: Bearer ${SECRET}' \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d @$PAYLOAD_FILE \\"
echo "    ${SEED_URL}/api/admin/seed-cache"
echo ""

# Si SEED_URL y ADMIN_SECRET están configurados, subir automáticamente
if [ -n "${ADMIN_SECRET:-}" ] && [[ "${SEED_URL}" != *"<"* ]]; then
  echo "🚀 ADMIN_SECRET y SEED_URL detectados — subiendo automáticamente..."
  RESPONSE=$(curl -s -X POST \
    -H "Authorization: Bearer ${ADMIN_SECRET}" \
    -H "Content-Type: application/json" \
    -d "@$PAYLOAD_FILE" \
    "${SEED_URL}/api/admin/seed-cache")
  echo "Respuesta: $RESPONSE"
  
  if echo "$RESPONSE" | grep -q '"ok":true'; then
    echo "✅ Seed completado exitosamente"
  else
    echo "❌ Error en el seed. Verificar respuesta arriba."
    exit 1
  fi
else
  echo "💡 Para subir automáticamente:"
  echo "   ADMIN_SECRET=xxx SEED_URL=https://sportspulse-qc6r.onrender.com pnpm pack-cache"
fi

echo ""
echo "✅ Pack listo. Archivos en $OUT_DIR/"
