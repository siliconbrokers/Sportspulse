export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: unknown | null;
  };
}

export function toErrorEnvelope(code: string, message: string, details?: unknown): ErrorEnvelope {
  return {
    error: {
      code,
      message,
      details: details ?? null,
    },
  };
}
