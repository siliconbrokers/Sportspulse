#!/usr/bin/env bash
# prod-status.sh — consulta /api/ui/status en producción y muestra estado del budget AF
#
# Uso:
#   ./scripts/prod-status.sh https://tu-app.onrender.com
#   PROD_URL=https://tu-app.onrender.com ./scripts/prod-status.sh
#   ./scripts/prod-status.sh          # usa localhost:3000 si no se pasa nada

set -euo pipefail

BASE_URL="${1:-${PROD_URL:-http://localhost:3000}}"
URL="${BASE_URL}/api/ui/status"

echo "SportsPulse — Status Check"
echo "URL: $URL"
echo "$(date)"
echo "─────────────────────────────────────────"

RAW=$(curl -sf --max-time 10 "$URL") || {
  echo "ERROR: no se pudo conectar a $URL"
  exit 1
}

# ── Server ────────────────────────────────────────────────────────────────────
OK=$(echo "$RAW"        | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ok','?'))")
UPTIME=$(echo "$RAW"   | python3 -c "import sys,json; d=json.load(sys.stdin); u=d.get('uptime',0); print(f'{u//3600}h {(u%3600)//60}m {u%60}s')")
ALL_LOADED=$(echo "$RAW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('allLoaded','?'))")

echo ""
echo "SERVER"
echo "  ok:         $OK"
echo "  uptime:     $UPTIME"
echo "  allLoaded:  $ALL_LOADED"

# ── API-Football budget ───────────────────────────────────────────────────────
echo ""
echo "API-FOOTBALL BUDGET"

BUDGET=$(echo "$RAW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('apifootball')))" 2>/dev/null || echo "null")

if [ "$BUDGET" = "null" ] || [ -z "$BUDGET" ]; then
  echo "  (no disponible — servidor antiguo o APIFOOTBALL_KEY no configurada)"
else
  REQ=$(echo "$BUDGET"       | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['requestsToday'])")
  LIM=$(echo "$BUDGET"       | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['limit'])")
  REM=$(echo "$BUDGET"       | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['remainingToday'])")
  EXH=$(echo "$BUDGET"       | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['exhausted'])")
  BRAKE=$(echo "$BUDGET"     | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['brakeActive'])")
  RESETS=$(echo "$BUDGET"    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('quotaResetsAt') or '—')")

  # Color: rojo si exhausted, amarillo si >80%, verde si OK
  if [ "$EXH" = "True" ] || [ "$EXH" = "true" ]; then
    STATUS_COLOR="\033[0;31m[AGOTADA]"
  elif [ "$REM" -lt 20 ] 2>/dev/null; then
    STATUS_COLOR="\033[0;33m[ALERTA <20]"
  else
    STATUS_COLOR="\033[0;32m[OK]"
  fi

  echo -e "  requests hoy:   $REQ / $LIM  $STATUS_COLOR\033[0m"
  echo    "  restantes hoy:  $REM"
  echo    "  exhausted:      $EXH"
  echo    "  brake activo:   $BRAKE"
  echo    "  cuota reset:    $RESETS"

  # Barra de progreso
  if [ "$LIM" -gt 0 ] 2>/dev/null; then
    PCT=$(( REQ * 100 / LIM ))
    FILL=$(( REQ * 40 / LIM ))
    BAR=""
    for ((i=0; i<FILL; i++)); do BAR+="█"; done
    for ((i=FILL; i<40; i++)); do BAR+="░"; done
    echo ""
    echo "  [$BAR] ${PCT}%"
  fi
fi

# ── Env keys ──────────────────────────────────────────────────────────────────
echo ""
echo "ENV KEYS"
echo "$RAW" | python3 -c "
import sys, json
d = json.load(sys.stdin)
env = d.get('env', {})
for k, v in env.items():
    mark = '✓' if v == 'set' else '✗ MISSING'
    print(f'  {k}: {mark}')
"

# ── Disk persistence check ────────────────────────────────────────────────────
echo ""
echo "DISK PERSISTENCE"
DISK_OK=false

# Si el budget dice requestsToday > 0 al arrancar, probablemente se restauró de disco.
# No podemos saberlo directo sin logs, pero damos el hint.
if [ "$BUDGET" != "null" ] && [ -n "$BUDGET" ]; then
  REQ2=$(echo "$BUDGET" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['requestsToday'])")
  if [ "$REQ2" -gt 0 ] 2>/dev/null; then
    echo "  requestsToday=$REQ2 > 0  →  puede indicar disco OK (o requests en sesión actual)"
    echo "  Para confirmar: ver logs de Render — buscar '[AfBudget] Restaurado desde disco'"
  else
    echo "  requestsToday=0  →  arranque limpio (primer deploy o disco vacío)"
  fi
fi

echo ""
echo "─────────────────────────────────────────"
echo "Timestamp servidor: $(echo "$RAW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ts','?'))")"
