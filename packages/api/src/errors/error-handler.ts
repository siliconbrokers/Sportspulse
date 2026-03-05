import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from './app-error.js';
import { ErrorCode } from './error-codes.js';
import { toErrorEnvelope } from './error-envelope.js';

async function errorHandler(fastify: FastifyInstance): Promise<void> {
  fastify.setErrorHandler((error: Error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(toErrorEnvelope(error.code, error.message, error.details));
    }

    // Fastify validation errors
    if ('validation' in error && (error as { validation: unknown }).validation) {
      return reply.status(400).send(toErrorEnvelope(ErrorCode.BAD_REQUEST, error.message));
    }

    // Unknown errors
    return reply.status(500).send(toErrorEnvelope(ErrorCode.INTERNAL_ERROR, 'Internal server error'));
  });
}

export const errorHandlerPlugin = fp(errorHandler, { name: 'error-handler' });
