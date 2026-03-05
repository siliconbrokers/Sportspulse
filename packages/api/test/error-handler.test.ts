import { describe, it, expect, beforeAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { errorHandlerPlugin } from '../src/errors/error-handler.js';
import { AppError } from '../src/errors/app-error.js';
import { ErrorCode } from '../src/errors/error-codes.js';

describe('errorHandlerPlugin', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);

    // Test routes that throw different errors
    app.get('/bad-request', async () => {
      throw new AppError(ErrorCode.BAD_REQUEST, 'Missing required field', 400);
    });

    app.get('/not-found', async () => {
      throw new AppError(ErrorCode.NOT_FOUND, 'Resource not found', 404);
    });

    app.get('/build-failed', async () => {
      throw new AppError(ErrorCode.SNAPSHOT_BUILD_FAILED, 'Build failed', 503);
    });

    app.get('/unknown-error', async () => {
      throw new Error('Something unexpected');
    });

    await app.ready();
  });

  it('BAD_REQUEST → 400 with error envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/bad-request' });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toBe('Missing required field');
    expect(body.error.details).toBeNull();
  });

  it('NOT_FOUND → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/not-found' });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('SNAPSHOT_BUILD_FAILED → 503', async () => {
    const res = await app.inject({ method: 'GET', url: '/build-failed' });
    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('SNAPSHOT_BUILD_FAILED');
  });

  it('unknown error → 500 INTERNAL_ERROR', async () => {
    const res = await app.inject({ method: 'GET', url: '/unknown-error' });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Internal server error');
  });
});
