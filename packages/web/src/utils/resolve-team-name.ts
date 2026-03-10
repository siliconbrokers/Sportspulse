/**
 * resolveTeamName — única fuente de verdad para mostrar nombres de equipo.
 *
 * Regla binaria:
 *  - compact=true  (mobile / tile pequeño) → TLA canónico de 3 letras si existe,
 *                  sino primeras 3 letras del nombre en mayúsculas
 *  - compact=false (desktop / espacio amplio) → nombre completo siempre
 */
export function resolveTeamName(
  name: string,
  options?: { tla?: string; compact?: boolean },
): string {
  const { tla, compact = false } = options ?? {};

  if (compact) {
    if (tla) return tla.toUpperCase();
    return name.slice(0, 3).toUpperCase();
  }

  return name;
}
