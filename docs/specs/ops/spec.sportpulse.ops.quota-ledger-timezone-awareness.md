---
artifact_id: SPEC-SPORTPULSE-OPS-QUOTA-LEDGER-TIMEZONE-AWARENESS
title: "Quota Ledger — Provider-Timezone-Aware Recording and Querying"
artifact_class: spec
status: proposed
version: 0.1.0
project: sportpulse
domain: ops
slug: quota-ledger-timezone-awareness
owner: team
created_at: 2026-03-20
updated_at: 2026-03-20
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-OPS-API-USAGE-GOVERNANCE
  - SPEC-SPORTPULSE-CORE-NON-FUNCTIONAL-REQUIREMENTS
  - SPEC-SPORTPULSE-AUDIT-RUNTIME-STORAGE-AND-SCALING-GAP-ANALYSIS
canonical_path: docs/specs/ops/spec.sportpulse.ops.quota-ledger-timezone-awareness.md
---

# SportPulse — Quota Ledger: Provider-Timezone-Aware Recording and Querying

Version: 0.1
Status: Proposed
Scope: Corrección del ledger de API usage para respetar el timezone y ventana de quota de cada provider
Audience: Backend, Ops, QA

---

## 1. Problem Statement

El campo `usageDateLocal` en `ApiUsageEvent` está definido como `"YYYY-MM-DD in provider timezone"` (ver `packages/shared/src/domain/api-usage.ts`), pero en la práctica **siempre se graba en UTC** (`new Date().toISOString().slice(0, 10)`), ignorando el `timezone` definido en `ProviderQuotaDefinition`.

Del mismo modo, `getAllTodayRollups()` en el ledger usa `currentDayUtc()` — una función que devuelve la fecha UTC — para **todos** los providers sin distinción, aunque cada provider puede tener su propio timezone de reset y su propia ventana de quota (diaria vs mensual).

### Consecuencias observadas

1. El panel `/admin/ops` muestra contadores en 0 cada noche a las 21:00 hora Uruguay (= medianoche UTC), incluso cuando el usuario aún está operando en el mismo día calendario local.
2. Si en el futuro se integra un provider con timezone no-UTC (e.g. YouTube que resetea a medianoche Pacific Time), `usageDateLocal` quedará registrada en la fecha UTC incorrecta, causando que el rollup quede en el día equivocado y el conteo de quota sea incorrecto.
3. Providers mensuales (The Odds API) no tienen este problema en la práctica actual porque el nivel mensual se maneja por separado con `getMonthTotal()`, pero el campo `usageDateLocal` sigue siendo semánticamente incorrecto.

### Por qué no fue visible antes

Todos los providers actuales tienen `timezone: 'UTC'` en su quota config. La incorrección es **por diseño defectuoso**, no por inconsistencia de datos actuales. El bug se vuelve visible solo cuando el usuario está en UTC-3 y el panel cambia de día a las 21:00 local.

---

## 2. Scope

### In scope

- Corrección del cálculo de `usageDateLocal` al grabar eventos: usar el timezone del provider
- Corrección de las queries del ledger para usar el "día actual en el timezone del provider"
- Corrección de la lógica de `getMonthTotal()` para usar el mes en el timezone del provider
- Documentación del contrato por provider al integrar una API nueva
- Tests que verifiquen el comportamiento correcto para providers con distintos timezones

### Out of scope

- Cambiar el timezone de ningún provider actual (todos son UTC — el comportamiento no cambia para el estado actual)
- Migrar datos históricos en SQLite (los datos ya grabados son correctos para providers UTC)
- Cambiar el modelo de datos de SQLite (schema permanece igual)
- Cambiar la UI del panel más allá de mostrar el timezone activo por provider

---

## 3. Authority

Subordinado a:
1. Constitution
2. Non-Functional Requirements
3. Repo Structure and Module Boundaries
4. API Usage Governance spec (cuando exista versión formal)

---

## 4. Current State

### 4.1 `ProviderQuotaDefinition` (ya existe, correcto)

```typescript
// packages/shared/src/domain/api-usage.ts
export interface ProviderQuotaDefinition {
  providerKey: ProviderKey;
  timezone: string;        // e.g. 'UTC', 'America/Los_Angeles'
  dailyLimit: number;      // 0 = no daily quota
  monthlyLimit?: number;   // 0/undefined = no monthly quota
  // ...
}
```

El campo `timezone` existe y está en SQLite. El problema está en que **no se usa**.

### 4.2 Providers actuales y sus ventanas

| Provider | Quota type | Window | Timezone | Reset |
|---|---|---|---|---|
| `api-football` | daily | day | UTC | medianoche UTC |
| `football-data` | daily | day | UTC | medianoche UTC |
| `youtube` | daily | day | UTC | medianoche UTC* |
| `the-odds-api` | monthly | month | UTC | 1° de cada mes UTC |
| `thesportsdb` | none | — | UTC | — |
| `eventos` | none | — | UTC | — |

*YouTube quota en realidad resetea a medianoche Pacific Time, pero está registrado como UTC. Corregirlo está **fuera de scope** de este ticket — se deja como nota para cuando importe operacionalmente.

### 4.3 Bug en `provider-client.ts`

```typescript
// packages/canonical/src/api-usage/provider-client.ts:200
usageDateLocal: params.startedAt.toISOString().slice(0, 10), // ❌ siempre UTC
```

### 4.4 Bug en `ledger.ts`

```typescript
// packages/canonical/src/api-usage/ledger.ts
function currentDayUtc(): string {
  return new Date().toISOString().slice(0, 10); // ❌ no recibe timezone
}

// Usado en TODOS los providers sin distinción:
getAllTodayRollups(): DailyRollup[] {
  const rows = this.stmtGetTodayRollups.all(currentDayUtc()); // ❌
}
```

---

## 5. Required Changes

### 5.1 Nuevo helper: `currentDayInTimezone(timezone: string): string`

Reemplaza `currentDayUtc()` en todos los contextos donde se necesite la fecha "de hoy" para un provider específico.

```typescript
// packages/canonical/src/api-usage/ledger.ts (o un archivo utils compartido)

/**
 * Returns the current date as YYYY-MM-DD in the given IANA timezone.
 * e.g. currentDayInTimezone('America/Montevideo') → '2026-03-20' even after midnight UTC
 * e.g. currentDayInTimezone('UTC') → identical to currentDayUtc()
 */
function currentDayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
}
```

`'en-CA'` produce formato `YYYY-MM-DD` de forma nativa y sin dependencias externas.

### 5.2 Nuevo helper: `currentMonthInTimezone(timezone: string): string`

Para providers mensuales.

```typescript
function currentMonthInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).format(new Date()).slice(0, 7); // 'YYYY-MM'
}
```

### 5.3 Derivación de quota window type

No se agrega un nuevo campo al schema. El tipo de ventana se **deriva** de los campos existentes:

```typescript
function quotaWindowType(quota: ProviderQuotaDefinition): 'daily' | 'monthly' | 'none' {
  if ((quota.monthlyLimit ?? 0) > 0) return 'monthly';
  if (quota.dailyLimit > 0) return 'daily';
  return 'none';
}
```

Regla: si tiene `monthlyLimit > 0` → mensual. Si tiene `dailyLimit > 0` → diario. Si ambos son 0 → sin quota.

### 5.4 Corrección del recording side (`provider-client.ts`)

El `InstrumentedProviderClient` debe recibir el `timezone` del provider y usarlo al grabar el evento.

**Cambio en constructor:**

```typescript
// Antes:
constructor(public readonly providerKey: ProviderKey)

// Después:
constructor(
  public readonly providerKey: ProviderKey,
  private readonly providerTimezone: string = 'UTC',
)
```

**Cambio en `recordEvent()`:**

```typescript
// Antes:
usageDateLocal: params.startedAt.toISOString().slice(0, 10),

// Después:
usageDateLocal: currentDayInTimezone(this.providerTimezone),
```

**Wiring en los callers:** Todos los lugares que instancian `InstrumentedProviderClient` deben pasar el timezone del provider. El timezone viene del `ProviderQuotaDefinition` que ya se lee desde SQLite/defaults al arrancar.

### 5.5 Corrección del query side (`ledger.ts`)

`getAllTodayRollups()` debe conocer el timezone de cada provider para devolver los rollups del "hoy correcto" para cada uno.

**Opción elegida:** el ledger recibe acceso al `QuotaConfigStore` (ya lo tiene como dependencia en la implementación actual) y lo usa para determinar la fecha correcta por provider.

```typescript
// Nuevo método (reemplaza getAllTodayRollups):
getAllCurrentWindowRollups(): DailyRollup[] {
  const quotas = this.quotaConfig.getAll();
  const results: DailyRollup[] = [];

  for (const quota of quotas) {
    const windowType = quotaWindowType(quota);
    if (windowType === 'none') continue;

    const dateKey = windowType === 'monthly'
      ? currentMonthInTimezone(quota.timezone) + '%'  // LIKE 'YYYY-MM%'
      : currentDayInTimezone(quota.timezone);         // exact 'YYYY-MM-DD'

    const rows = windowType === 'monthly'
      ? this.db.prepare(`SELECT ... WHERE provider_key = ? AND usage_date_local LIKE ?`)
               .all(quota.providerKey, dateKey)
      : this.stmtGetTodayRollups.all(quota.providerKey, dateKey);

    results.push(...rows.map(rowToRollup));
  }
  return results;
}
```

> **Nota de implementación:** el `stmtGetTodayRollups` actual no filtra por `provider_key`. Se necesita una variante que filtre por `(provider_key, date)`. Alternativamente, puede filtrarse en memoria después del SELECT — dado el volumen (≤6 providers × ≤3 consumer types = ≤18 filas), el overhead es despreciable.

### 5.6 Corrección de `getMonthTotal()`

```typescript
// Antes: usa yearMonth pasado por el caller (que usa currentDayUtc().slice(0, 7))
getMonthTotal(providerKey: ProviderKey, yearMonth: string): number

// Después: el ledger deriva el mes correcto internamente usando el timezone del provider
getMonthTotal(providerKey: ProviderKey): number {
  const quota = this.quotaConfig.get(providerKey);
  const tz = quota?.timezone ?? 'UTC';
  const yearMonth = currentMonthInTimezone(tz);
  // ... resto igual
}
```

El caller en `api-usage-routes.ts` pasa `yearMonth` actualmente — eliminar ese parámetro y dejar que el ledger lo calcule.

### 5.7 Interface `IApiUsageLedger` en `packages/api`

Actualizar la interfaz estructural para reflejar la firma corregida:

```typescript
// packages/api/src/internal/api-usage-routes.ts
export interface IApiUsageLedger {
  getAllCurrentWindowRollups(): DailyRollup[];  // reemplaza getAllTodayRollups
  getMonthTotal(providerKey: ProviderKey): number;  // sin yearMonth
  // ... resto sin cambios
}
```

### 5.8 Exposición del timezone activo en la respuesta del endpoint `/today`

Agregar `quotaTimezone` y `quotaWindowType` al objeto de cada provider en la respuesta:

```json
{
  "providers": [
    {
      "providerKey": "api-football",
      "quotaTimezone": "UTC",
      "quotaWindowType": "daily",
      "currentWindowDate": "2026-03-21",
      ...
    },
    {
      "providerKey": "the-odds-api",
      "quotaTimezone": "UTC",
      "quotaWindowType": "monthly",
      "currentWindowDate": "2026-03",
      ...
    }
  ]
}
```

Esto permite que la UI muestre "día: 2026-03-21 UTC" o "mes: marzo 2026 UTC" por cada provider, eliminando la confusión del reset.

### 5.9 UI: mostrar ventana activa por provider

En `ProviderSummaryGrid.tsx`, reemplazar el texto genérico "usadas este mes / usadas hoy" por la ventana real del provider usando los nuevos campos `quotaWindowType` y `currentWindowDate`.

---

## 6. Contract por provider al integrar una API nueva

Cuando se integra una nueva API al sistema de quota governance, los siguientes campos son **obligatorios** en su `ProviderQuotaDefinition`:

| Campo | Requerido | Descripción |
|---|---|---|
| `timezone` | **Sí** | IANA timezone en el que el provider resetea su quota. Default: `'UTC'`. Nunca omitir. |
| `dailyLimit` | **Sí** | Límite diario en unidades. `0` si no aplica límite diario. |
| `monthlyLimit` | **Sí** | Límite mensual en unidades. `0` si no aplica límite mensual. |
| `warningThresholdPct` | **Sí** | Porcentaje al que activar WARNING. |
| `criticalThresholdPct` | **Sí** | Porcentaje al que activar CRITICAL. |
| `hardStopThresholdPct` | **Sí** | Porcentaje al que activar EXHAUSTED y hard-stop. |

**Reglas:**
- No puede tener `dailyLimit > 0` y `monthlyLimit > 0` simultáneamente (ventanas mutuamente excluyentes).
- Si el provider tiene plan de pago que incluye un overage fee en lugar de hard block, documentarlo en `notes` y configurar `hardStopThresholdPct: 100`.
- Si el timezone exacto de reset no está documentado por el provider, usar `'UTC'` y documentar la asunción en `notes`.

---

## 7. Affected files

| File | Change |
|---|---|
| `packages/canonical/src/api-usage/ledger.ts` | Agregar helpers `currentDayInTimezone`, `currentMonthInTimezone`; nuevo `getAllCurrentWindowRollups()`; corrección de `getMonthTotal()` |
| `packages/canonical/src/api-usage/provider-client.ts` | Constructor acepta `providerTimezone`; `usageDateLocal` usa `currentDayInTimezone` |
| `packages/canonical/src/api-usage/quota-config.ts` | Sin cambios de schema; agregar helper exportado `quotaWindowType()` |
| `packages/canonical/src/api-usage/index.ts` | Exportar `quotaWindowType`, helpers si necesario |
| `packages/api/src/internal/api-usage-routes.ts` | Actualizar interface `IApiUsageLedger`; agregar `quotaTimezone`, `quotaWindowType`, `currentWindowDate` a respuesta |
| `packages/api/test/api-usage-routes.test.ts` | Actualizar mock + tests |
| `packages/web/src/admin/ProviderSummaryGrid.tsx` | Usar `quotaWindowType` y `currentWindowDate` para display |
| `packages/web/src/hooks/use-api-usage.ts` | Agregar `quotaTimezone`, `quotaWindowType`, `currentWindowDate` a `ProviderSummaryItem` |
| `server/` (callers de `InstrumentedProviderClient`) | Pasar `providerTimezone` al constructor |

---

## 8. Migration impact

- **Schema SQLite:** sin cambios. El campo `usage_date_local` ya existe.
- **Datos históricos:** no requieren migración. Los datos existentes son correctos para providers UTC. Para providers no-UTC que se agreguen en el futuro, los datos comenzarán a grabarse correctamente desde el momento del fix.
- **Breaking changes en API:** la adición de `quotaTimezone`, `quotaWindowType`, `currentWindowDate` es aditiva. La firma de `getMonthTotal()` cambia (pierde el parámetro `yearMonth`) — esto afecta solo a `api-usage-routes.ts` y a los tests del mock.

---

## 9. Acceptance criteria

### Functional

- `usageDateLocal` grabado en el timezone correcto del provider para un evento ocurrido en cualquier hora del día
- `getAllCurrentWindowRollups()` devuelve los rollups del día correcto para cada provider según su timezone
- El panel `/admin/ops` no "resetea" visualmente a las 21:00 Uruguay para providers con timezone UTC (el comportamiento será el mismo que antes, pero ahora correcto por diseño)
- La respuesta del endpoint incluye `quotaTimezone`, `quotaWindowType`, `currentWindowDate` por provider
- El panel muestra la ventana activa por provider ("día: 2026-03-21 UTC" o "mes: marzo 2026 UTC")

### Tests requeridos

- `usageDateLocal` para un evento UTC-midnight usando timezone `'America/Montevideo'` produce fecha correcta (no la UTC)
- `getAllCurrentWindowRollups()` con un provider `timezone: 'America/New_York'` devuelve los rollups del día Eastern, no UTC
- `getMonthTotal()` para un provider mensual devuelve el total del mes correcto en su timezone
- Provider con `dailyLimit: 0, monthlyLimit: 20000` → `quotaWindowType: 'monthly'`
- Provider con `dailyLimit: 7500, monthlyLimit: 0` → `quotaWindowType: 'daily'`
- Provider con `dailyLimit: 0, monthlyLimit: 0` → `quotaWindowType: 'none'`

### Regression (existing cases must still pass)

- Tests existentes de `api-usage-routes.test.ts` deben seguir pasando
- Tests existentes del ledger deben seguir pasando (adaptar mocks si cambia la firma)
- Build limpio sin errores de tipos

---

## 10. Risks

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| `currentDayInTimezone` con timezone inválida | Baja | Alto | `Intl.DateTimeFormat` lanza `RangeError` — capturar y fallback a UTC con `console.warn` |
| Callers de `InstrumentedProviderClient` que no pasen timezone | Media | Medio | Default `'UTC'` → comportamiento idéntico al actual para todos los providers existentes |
| `getMonthTotal()` sin parámetro `yearMonth` rompe tests existentes | Alta | Bajo | Solo requiere actualizar mock en `api-usage-routes.test.ts` |
| Confusion al auditar si el tiempo de reset real de un provider es incorrecto | Media | Bajo | Agregar `notes` al quota config con fuente de verdad del timezone |

---

## 11. Non-goals

- No cambia el timezone de ningún provider actual (todos son `'UTC'` y quedan `'UTC'`)
- No migra datos históricos
- No agrega soporte para ventanas de quota custom (e.g. "cada 30 días desde la fecha de suscripción")
- No implementa alertas o notificaciones cuando el día UTC avanza

---

## 12. Done criteria

- Todos los acceptance criteria verificados
- Build limpio
- Tests pasan (incluyendo nuevos)
- El panel muestra la ventana activa por provider sin ambigüedad
- El contrato de integración (§6) está documentado y disponible para futuras integraciones

---

## 13. One-paragraph summary

El ledger de API usage registra `usageDateLocal` siempre en UTC e ignora el `timezone` definido en `ProviderQuotaDefinition`, a pesar de que el campo está diseñado para almacenar la fecha en el timezone del provider. Esto produce que el panel de ops "resetee" visualmente a las 21:00 hora Uruguay (medianoche UTC), y que providers con timezone no-UTC grabarían sus rollups en la fecha incorrecta. Este spec corrige la grabación de eventos y las queries del ledger para respetar el timezone y la ventana de quota (diaria vs mensual) de cada provider, sin cambiar el schema de datos ni el comportamiento actual para los providers ya configurados (todos UTC). Adicionalmente, documenta el contrato obligatorio para integrar nuevas APIs al sistema de governance.
