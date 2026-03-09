export { ErrorCode, AppError, toErrorEnvelope, errorHandlerPlugin } from './errors/index.js';
export type { ErrorCodeValue, ErrorEnvelope } from './errors/index.js';

export { buildApp } from './app.js';
export type { AppDependencies, IUpcomingService, UpcomingMatchDTO } from './ui/types.js';
