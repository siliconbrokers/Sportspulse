# Plan: SP-0603 — Error Envelope & Error Codes

## Tier: sonnet (no Opus design needed)

## Spec refs
- api-contract-corrected.md §4

## Implementation

### Error codes enum
```ts
export const ErrorCode = {
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  SNAPSHOT_BUILD_FAILED: 'SNAPSHOT_BUILD_FAILED',
} as const;
```

### Error envelope shape
```ts
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: unknown | null;
  };
}
```

### Fastify error handler plugin
```ts
export function errorHandlerPlugin(fastify: FastifyInstance): void {
  fastify.setErrorHandler((error, request, reply) => {
    // Map to error envelope
  });
}
```

### AppError class
```ts
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) { super(message); }
}
```

Status code mapping: BAD_REQUEST→400, NOT_FOUND→404, SNAPSHOT_BUILD_FAILED→503, etc.

## Files
- Create: `packages/api/src/errors/error-codes.ts`
- Create: `packages/api/src/errors/app-error.ts`
- Create: `packages/api/src/errors/error-handler.ts` (Fastify plugin)
- Create: `packages/api/test/error-handler.test.ts`

## Tests: F-02, F-03, F-04
- AppError with BAD_REQUEST → 400 response with correct envelope
- AppError with NOT_FOUND → 404
- AppError with SNAPSHOT_BUILD_FAILED → 503
- Unknown errors → 500 INTERNAL_ERROR envelope
