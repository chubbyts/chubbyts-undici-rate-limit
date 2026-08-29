import { describe, expect, test } from 'vitest';
import { useFunctionMock } from '@chubbyts/chubbyts-function-mock/dist/function-mock';
import { useObjectMock } from '@chubbyts/chubbyts-function-mock/dist/object-mock';
import type { Handler } from '@chubbyts/chubbyts-undici-server/dist/server';
import { Response, ServerRequest } from '@chubbyts/chubbyts-undici-server/dist/server';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import type { KeyResolver } from '../src/key-resolver';
import type { LimitExceededHandler, RateLimiter } from '../src/middleware';
import { createDefaultLimitExceededHandler, createRateLimitMiddleware } from '../src/middleware';

describe('middleware', () => {
  describe('createDefaultLimitExceededHandler', () => {
    test('createDefaultLimitExceededHandler', async () => {
      const request = new ServerRequest('https://example.com');

      const response = await createDefaultLimitExceededHandler()(request, { limit: 10, remaining: 0, reset: 30 });

      expect(response.status).toBe(429);
      expect(response.statusText).toBe('Too Many Requests');
      expect(Object.fromEntries(response.headers.entries())).toMatchInlineSnapshot(`
        {
          "content-type": "text/plain; charset=utf-8",
        }
      `);
      expect(await response.text()).toBe('Too Many Requests');
    });
  });

  describe('createRateLimitMiddleware', () => {
    test('without key', async () => {
      const request = new ServerRequest('https://example.com/resource', { method: 'POST' });

      const [handler, handlerMocks] = useFunctionMock<Handler>([]);

      const [keyResolver, keyResolverMocks] = useFunctionMock<KeyResolver>([
        { parameters: [request], return: undefined },
      ]);

      const [rateLimiter, rateLimiterMocks] = useObjectMock<RateLimiter>([]);

      const middleware = createRateLimitMiddleware(keyResolver, rateLimiter);

      await expect(middleware(request, handler)).rejects.toThrow(
        'Missing rate limit key for POST https://example.com/resource: the key resolver resolved no key, chain a resolver with a key every request has (e.g. the "clientIp" attribute)',
      );

      expect(handlerMocks).toHaveLength(0);
      expect(keyResolverMocks).toHaveLength(0);
      expect(rateLimiterMocks).toHaveLength(0);
    });

    test('with key, within limit', async () => {
      const request = new ServerRequest('https://example.com');
      const headers = new Headers({ 'x-custom': 'value' });
      headers.append('set-cookie', 'a=1');
      headers.append('set-cookie', 'b=2');

      const response = new Response('body', { status: 201, statusText: 'Created', headers });

      const [handler, handlerMocks] = useFunctionMock<Handler>([
        { parameters: [request], return: Promise.resolve(response) },
      ]);

      const [keyResolver, keyResolverMocks] = useFunctionMock<KeyResolver>([
        { parameters: [request], return: '203.0.113.1' },
      ]);

      const [rateLimiter, rateLimiterMocks] = useObjectMock<RateLimiter>([
        { name: 'points', value: 10 },
        {
          name: 'consume',
          parameters: ['203.0.113.1'],
          return: Promise.resolve(new RateLimiterRes(7, 12_001, 3, false)),
        },
      ]);

      const middleware = createRateLimitMiddleware(keyResolver, rateLimiter);

      const rateLimitResponse = await middleware(request, handler);

      // the headers get set on the handler's response, no rebuild (which would fail on an already read body)
      expect(rateLimitResponse).toBe(response);
      expect(rateLimitResponse.status).toBe(201);
      expect(rateLimitResponse.statusText).toBe('Created');
      expect([...rateLimitResponse.headers.entries()]).toMatchInlineSnapshot(`
        [
          [
            "content-type",
            "text/plain;charset=UTF-8",
          ],
          [
            "ratelimit-limit",
            "10",
          ],
          [
            "ratelimit-remaining",
            "7",
          ],
          [
            "ratelimit-reset",
            "13",
          ],
          [
            "set-cookie",
            "a=1",
          ],
          [
            "set-cookie",
            "b=2",
          ],
          [
            "x-custom",
            "value",
          ],
        ]
      `);
      expect(await rateLimitResponse.text()).toBe('body');

      expect(handlerMocks).toHaveLength(0);
      expect(keyResolverMocks).toHaveLength(0);
      expect(rateLimiterMocks).toHaveLength(0);
    });

    test('with key, at limit', async () => {
      const request = new ServerRequest('https://example.com');
      const response = new Response();

      const [handler, handlerMocks] = useFunctionMock<Handler>([
        { parameters: [request], return: Promise.resolve(response) },
      ]);

      const [keyResolver, keyResolverMocks] = useFunctionMock<KeyResolver>([
        { parameters: [request], return: '203.0.113.1' },
      ]);

      const [rateLimiter, rateLimiterMocks] = useObjectMock<RateLimiter>([
        { name: 'points', value: 10 },
        {
          name: 'consume',
          parameters: ['203.0.113.1'],
          return: Promise.resolve(new RateLimiterRes(0, 1000, 10, false)),
        },
      ]);

      const middleware = createRateLimitMiddleware(keyResolver, rateLimiter);

      const rateLimitResponse = await middleware(request, handler);

      expect(rateLimitResponse.status).toBe(200);
      expect(Object.fromEntries(rateLimitResponse.headers.entries())).toMatchInlineSnapshot(`
        {
          "ratelimit-limit": "10",
          "ratelimit-remaining": "0",
          "ratelimit-reset": "1",
        }
      `);

      expect(handlerMocks).toHaveLength(0);
      expect(keyResolverMocks).toHaveLength(0);
      expect(rateLimiterMocks).toHaveLength(0);
    });

    test('with key, exceeded, with default limit exceeded handler', async () => {
      const request = new ServerRequest('https://example.com');

      const [handler, handlerMocks] = useFunctionMock<Handler>([]);

      const [keyResolver, keyResolverMocks] = useFunctionMock<KeyResolver>([
        { parameters: [request], return: '203.0.113.1' },
      ]);

      const [rateLimiter, rateLimiterMocks] = useObjectMock<RateLimiter>([
        { name: 'points', value: 10 },
        { name: 'consume', parameters: ['203.0.113.1'], return: Promise.reject(new RateLimiterRes(0, 400, 11, false)) },
      ]);

      const middleware = createRateLimitMiddleware(keyResolver, rateLimiter);

      const rateLimitResponse = await middleware(request, handler);

      expect(rateLimitResponse.status).toBe(429);
      expect(rateLimitResponse.statusText).toBe('Too Many Requests');
      expect(Object.fromEntries(rateLimitResponse.headers.entries())).toMatchInlineSnapshot(`
        {
          "content-type": "text/plain; charset=utf-8",
          "ratelimit-limit": "10",
          "ratelimit-remaining": "0",
          "ratelimit-reset": "1",
          "retry-after": "1",
        }
      `);
      expect(await rateLimitResponse.text()).toBe('Too Many Requests');

      expect(handlerMocks).toHaveLength(0);
      expect(keyResolverMocks).toHaveLength(0);
      expect(rateLimiterMocks).toHaveLength(0);
    });

    test('with key, exceeded, with custom limit exceeded handler', async () => {
      const request = new ServerRequest('https://example.com');
      const response = new Response('{"error":"slow down"}', {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'content-type': 'application/json' },
      });

      const [handler, handlerMocks] = useFunctionMock<Handler>([]);

      const [keyResolver, keyResolverMocks] = useFunctionMock<KeyResolver>([
        { parameters: [request], return: '203.0.113.1' },
      ]);

      const [rateLimiter, rateLimiterMocks] = useObjectMock<RateLimiter>([
        { name: 'points', value: 10 },
        { name: 'consume', parameters: ['203.0.113.1'], return: Promise.reject(new RateLimiterRes(0, 0, 15, false)) },
      ]);

      const [limitExceededHandler, limitExceededHandlerMocks] = useFunctionMock<LimitExceededHandler>([
        { parameters: [request, { limit: 10, remaining: 0, reset: 0 }], return: Promise.resolve(response) },
      ]);

      const middleware = createRateLimitMiddleware(keyResolver, rateLimiter, limitExceededHandler);

      const rateLimitResponse = await middleware(request, handler);

      expect(rateLimitResponse.status).toBe(429);
      expect(Object.fromEntries(rateLimitResponse.headers.entries())).toMatchInlineSnapshot(`
        {
          "content-type": "application/json",
          "ratelimit-limit": "10",
          "ratelimit-remaining": "0",
          "ratelimit-reset": "0",
          "retry-after": "1",
        }
      `);
      expect(await rateLimitResponse.text()).toBe('{"error":"slow down"}');

      expect(handlerMocks).toHaveLength(0);
      expect(keyResolverMocks).toHaveLength(0);
      expect(rateLimiterMocks).toHaveLength(0);
      expect(limitExceededHandlerMocks).toHaveLength(0);
    });

    test('with key, exceeded, with rate limiter res of a foreign rate-limiter-flexible copy', async () => {
      const request = new ServerRequest('https://example.com');

      const [handler, handlerMocks] = useFunctionMock<Handler>([]);

      const [keyResolver, keyResolverMocks] = useFunctionMock<KeyResolver>([
        { parameters: [request], return: '203.0.113.1' },
      ]);

      const [rateLimiter, rateLimiterMocks] = useObjectMock<RateLimiter>([
        { name: 'points', value: 10 },
        {
          name: 'consume',
          parameters: ['203.0.113.1'],
          return: Promise.reject({
            remainingPoints: 0,
            msBeforeNext: 2500,
            consumedPoints: 11,
            isFirstInDuration: false,
          }),
        },
      ]);

      const middleware = createRateLimitMiddleware(keyResolver, rateLimiter);

      const rateLimitResponse = await middleware(request, handler);

      expect(rateLimitResponse.status).toBe(429);
      expect(rateLimitResponse.headers.get('ratelimit-remaining')).toBe('0');
      expect(rateLimitResponse.headers.get('retry-after')).toBe('3');

      expect(handlerMocks).toHaveLength(0);
      expect(keyResolverMocks).toHaveLength(0);
      expect(rateLimiterMocks).toHaveLength(0);
    });

    test('with key, exceeded, with rate limit headers already set by the limit exceeded handler', async () => {
      const request = new ServerRequest('https://example.com');

      const [handler, handlerMocks] = useFunctionMock<Handler>([]);

      const [keyResolver, keyResolverMocks] = useFunctionMock<KeyResolver>([
        { parameters: [request], return: '203.0.113.1' },
      ]);

      const [rateLimiter, rateLimiterMocks] = useObjectMock<RateLimiter>([
        { name: 'points', value: 10 },
        {
          name: 'consume',
          parameters: ['203.0.113.1'],
          return: Promise.reject(new RateLimiterRes(0, 2500, 11, false)),
        },
      ]);

      const [limitExceededHandler, limitExceededHandlerMocks] = useFunctionMock<LimitExceededHandler>([
        {
          parameters: [request, { limit: 10, remaining: 0, reset: 3 }],
          return: Promise.resolve(
            new Response(null, {
              status: 429,
              headers: {
                'ratelimit-limit': 'spoofed',
                'ratelimit-remaining': 'spoofed',
                'ratelimit-reset': 'spoofed',
                'retry-after': '120',
              },
            }),
          ),
        },
      ]);

      const middleware = createRateLimitMiddleware(keyResolver, rateLimiter, limitExceededHandler);

      const rateLimitResponse = await middleware(request, handler);

      // set (not appended), otherwise the values would be comma joined ("spoofed, 10")
      expect([...rateLimitResponse.headers.entries()]).toMatchInlineSnapshot(`
        [
          [
            "ratelimit-limit",
            "10",
          ],
          [
            "ratelimit-remaining",
            "0",
          ],
          [
            "ratelimit-reset",
            "3",
          ],
          [
            "retry-after",
            "3",
          ],
        ]
      `);

      expect(handlerMocks).toHaveLength(0);
      expect(keyResolverMocks).toHaveLength(0);
      expect(rateLimiterMocks).toHaveLength(0);
      expect(limitExceededHandlerMocks).toHaveLength(0);
    });

    test('with key, within limit, with retry-after set by the handler', async () => {
      const request = new ServerRequest('https://example.com');
      const response = new Response(null, { status: 503, headers: { 'retry-after': '120' } });

      const [handler, handlerMocks] = useFunctionMock<Handler>([
        { parameters: [request], return: Promise.resolve(response) },
      ]);

      const [keyResolver, keyResolverMocks] = useFunctionMock<KeyResolver>([
        { parameters: [request], return: '203.0.113.1' },
      ]);

      const [rateLimiter, rateLimiterMocks] = useObjectMock<RateLimiter>([
        { name: 'points', value: 10 },
        {
          name: 'consume',
          parameters: ['203.0.113.1'],
          return: Promise.resolve(new RateLimiterRes(7, 12_001, 3, false)),
        },
      ]);

      const middleware = createRateLimitMiddleware(keyResolver, rateLimiter);

      const rateLimitResponse = await middleware(request, handler);

      // the handler's retry-after is none of the middleware's business within the limit
      expect(rateLimitResponse.status).toBe(503);
      expect(rateLimitResponse.headers.get('retry-after')).toBe('120');
      expect(rateLimitResponse.headers.get('ratelimit-remaining')).toBe('7');

      expect(handlerMocks).toHaveLength(0);
      expect(keyResolverMocks).toHaveLength(0);
      expect(rateLimiterMocks).toHaveLength(0);
    });

    test('with key, within limit, with already read body', async () => {
      const request = new ServerRequest('https://example.com');
      const response = new Response('body');
      await response.text();

      const [handler, handlerMocks] = useFunctionMock<Handler>([
        { parameters: [request], return: Promise.resolve(response) },
      ]);

      const [keyResolver, keyResolverMocks] = useFunctionMock<KeyResolver>([
        { parameters: [request], return: '203.0.113.1' },
      ]);

      const [rateLimiter, rateLimiterMocks] = useObjectMock<RateLimiter>([
        { name: 'points', value: 10 },
        {
          name: 'consume',
          parameters: ['203.0.113.1'],
          return: Promise.resolve(new RateLimiterRes(7, 12_001, 3, false)),
        },
      ]);

      const middleware = createRateLimitMiddleware(keyResolver, rateLimiter);

      const rateLimitResponse = await middleware(request, handler);

      expect(rateLimitResponse).toBe(response);
      expect(rateLimitResponse.headers.get('ratelimit-remaining')).toBe('7');

      expect(handlerMocks).toHaveLength(0);
      expect(keyResolverMocks).toHaveLength(0);
      expect(rateLimiterMocks).toHaveLength(0);
    });

    test('with key, within limit, with immutable headers (redirect)', async () => {
      const request = new ServerRequest('https://example.com');
      const response = Response.redirect('https://example.com/login', 302);
      // eslint-disable-next-line functional/immutable-data
      response.headers.set = () => {
        throw new TypeError('immutable');
      };

      const [handler, handlerMocks] = useFunctionMock<Handler>([
        { parameters: [request], return: Promise.resolve(response) },
      ]);

      const [keyResolver, keyResolverMocks] = useFunctionMock<KeyResolver>([
        { parameters: [request], return: '203.0.113.1' },
      ]);

      const [rateLimiter, rateLimiterMocks] = useObjectMock<RateLimiter>([
        { name: 'points', value: 10 },
        {
          name: 'consume',
          parameters: ['203.0.113.1'],
          return: Promise.resolve(new RateLimiterRes(7, 12_001, 3, false)),
        },
      ]);

      const middleware = createRateLimitMiddleware(keyResolver, rateLimiter);

      const rateLimitResponse = await middleware(request, handler);

      // rebuilt, as the headers could not be set
      expect(rateLimitResponse).not.toBe(response);
      expect(rateLimitResponse.status).toBe(302);
      expect(rateLimitResponse.headers.get('location')).toBe('https://example.com/login');
      expect(rateLimitResponse.headers.get('ratelimit-limit')).toBe('10');
      expect(rateLimitResponse.headers.get('ratelimit-remaining')).toBe('7');
      expect(rateLimitResponse.headers.get('ratelimit-reset')).toBe('13');

      expect(handlerMocks).toHaveLength(0);
      expect(keyResolverMocks).toHaveLength(0);
      expect(rateLimiterMocks).toHaveLength(0);
    });

    test('with key, within limit, with immutable rate limit headers (rebuild replaces them)', async () => {
      const request = new ServerRequest('https://example.com');
      const response = new Response(null, { headers: { 'ratelimit-limit': 'spoofed', 'x-custom': 'value' } });
      // eslint-disable-next-line functional/immutable-data
      response.headers.set = () => {
        throw new TypeError('immutable');
      };

      const [handler, handlerMocks] = useFunctionMock<Handler>([
        { parameters: [request], return: Promise.resolve(response) },
      ]);

      const [keyResolver, keyResolverMocks] = useFunctionMock<KeyResolver>([
        { parameters: [request], return: '203.0.113.1' },
      ]);

      const [rateLimiter, rateLimiterMocks] = useObjectMock<RateLimiter>([
        { name: 'points', value: 10 },
        {
          name: 'consume',
          parameters: ['203.0.113.1'],
          return: Promise.resolve(new RateLimiterRes(7, 12_001, 3, false)),
        },
      ]);

      const middleware = createRateLimitMiddleware(keyResolver, rateLimiter);

      const rateLimitResponse = await middleware(request, handler);

      expect([...rateLimitResponse.headers.entries()]).toMatchInlineSnapshot(`
        [
          [
            "ratelimit-limit",
            "10",
          ],
          [
            "ratelimit-remaining",
            "7",
          ],
          [
            "ratelimit-reset",
            "13",
          ],
          [
            "x-custom",
            "value",
          ],
        ]
      `);

      expect(handlerMocks).toHaveLength(0);
      expect(keyResolverMocks).toHaveLength(0);
      expect(rateLimiterMocks).toHaveLength(0);
    });

    test('with key, exceeded, with never resetting limit (duration 0)', async () => {
      const request = new ServerRequest('https://example.com');

      const [handler, handlerMocks] = useFunctionMock<Handler>([]);

      const [keyResolver, keyResolverMocks] = useFunctionMock<KeyResolver>([
        { parameters: [request], return: '203.0.113.1' },
      ]);

      const [rateLimiter, rateLimiterMocks] = useObjectMock<RateLimiter>([
        { name: 'points', value: 10 },
        { name: 'consume', parameters: ['203.0.113.1'], return: Promise.reject(new RateLimiterRes(0, -1, 11, false)) },
      ]);

      const [limitExceededHandler, limitExceededHandlerMocks] = useFunctionMock<LimitExceededHandler>([
        {
          parameters: [request, { limit: 10, remaining: 0, reset: undefined }],
          return: Promise.resolve(new Response(null, { status: 429 })),
        },
      ]);

      const middleware = createRateLimitMiddleware(keyResolver, rateLimiter, limitExceededHandler);

      const rateLimitResponse = await middleware(request, handler);

      // no reset / retry-after, as there is no point in time the client could retry
      expect(rateLimitResponse.status).toBe(429);
      expect(Object.fromEntries(rateLimitResponse.headers.entries())).toMatchInlineSnapshot(`
        {
          "ratelimit-limit": "10",
          "ratelimit-remaining": "0",
        }
      `);

      expect(handlerMocks).toHaveLength(0);
      expect(keyResolverMocks).toHaveLength(0);
      expect(rateLimiterMocks).toHaveLength(0);
      expect(limitExceededHandlerMocks).toHaveLength(0);
    });

    test('with async key resolver', async () => {
      const request = new ServerRequest('https://example.com');
      const response = new Response();

      const [handler, handlerMocks] = useFunctionMock<Handler>([
        { parameters: [request], return: Promise.resolve(response) },
      ]);

      const [keyResolver, keyResolverMocks] = useFunctionMock<KeyResolver>([
        { parameters: [request], return: Promise.resolve('tenant-1') },
      ]);

      const [rateLimiter, rateLimiterMocks] = useObjectMock<RateLimiter>([
        { name: 'points', value: 10 },
        { name: 'consume', parameters: ['tenant-1'], return: Promise.resolve(new RateLimiterRes(9, 1000, 1, true)) },
      ]);

      const middleware = createRateLimitMiddleware(keyResolver, rateLimiter);

      const rateLimitResponse = await middleware(request, handler);

      expect(rateLimitResponse).toBe(response);
      expect(rateLimitResponse.headers.get('ratelimit-remaining')).toBe('9');

      expect(handlerMocks).toHaveLength(0);
      expect(keyResolverMocks).toHaveLength(0);
      expect(rateLimiterMocks).toHaveLength(0);
    });

    test.each([
      null,
      'string',
      { remainingPoints: 0 },
      { msBeforeNext: 0 },
      { remainingPoints: '0', msBeforeNext: 0 },
      { remainingPoints: 0, msBeforeNext: 0 },
      { remainingPoints: 0, msBeforeNext: 0, consumedPoints: '1' },
      { msBeforeNext: 0, consumedPoints: 1 },
      { remainingPoints: 0, consumedPoints: 1 },
      { remainingPoints: 0, msBeforeNext: '0', consumedPoints: 1 },
      // a function (typeof 'function') with matching properties
      // eslint-disable-next-line functional/immutable-data
      Object.assign(() => undefined, { remainingPoints: 0, msBeforeNext: 0, consumedPoints: 1 }),
      // a real error must not be swallowed into a 429, even with matching properties
      new (class extends Error {
        remainingPoints = 0;
        msBeforeNext = 0;
        consumedPoints = 1;
      })('redis connection lost'),
    ])('with key, with non rate limiter res rejection %j', async (error) => {
      const request = new ServerRequest('https://example.com');

      const [handler, handlerMocks] = useFunctionMock<Handler>([]);

      const [keyResolver, keyResolverMocks] = useFunctionMock<KeyResolver>([
        { parameters: [request], return: '203.0.113.1' },
      ]);

      const [rateLimiter, rateLimiterMocks] = useObjectMock<RateLimiter>([
        { name: 'points', value: 10 },
        { name: 'consume', parameters: ['203.0.113.1'], return: Promise.reject(error) },
      ]);

      const middleware = createRateLimitMiddleware(keyResolver, rateLimiter);

      await expect(middleware(request, handler)).rejects.toBe(error);

      expect(handlerMocks).toHaveLength(0);
      expect(keyResolverMocks).toHaveLength(0);
      expect(rateLimiterMocks).toHaveLength(0);
    });

    test('with key, with limiter error', async () => {
      const request = new ServerRequest('https://example.com');
      const error = new Error('redis connection lost');

      const [handler, handlerMocks] = useFunctionMock<Handler>([]);

      const [keyResolver, keyResolverMocks] = useFunctionMock<KeyResolver>([
        { parameters: [request], return: '203.0.113.1' },
      ]);

      const [rateLimiter, rateLimiterMocks] = useObjectMock<RateLimiter>([
        { name: 'points', value: 10 },
        { name: 'consume', parameters: ['203.0.113.1'], return: Promise.reject(error) },
      ]);

      const middleware = createRateLimitMiddleware(keyResolver, rateLimiter);

      await expect(middleware(request, handler)).rejects.toBe(error);

      expect(handlerMocks).toHaveLength(0);
      expect(keyResolverMocks).toHaveLength(0);
      expect(rateLimiterMocks).toHaveLength(0);
    });

    test('with key, with handler error', async () => {
      const request = new ServerRequest('https://example.com');
      const error = new Error('handler failed');

      const [handler, handlerMocks] = useFunctionMock<Handler>([
        { parameters: [request], return: Promise.reject(error) },
      ]);

      const [keyResolver, keyResolverMocks] = useFunctionMock<KeyResolver>([
        { parameters: [request], return: '203.0.113.1' },
      ]);

      const [rateLimiter, rateLimiterMocks] = useObjectMock<RateLimiter>([
        { name: 'points', value: 10 },
        { name: 'consume', parameters: ['203.0.113.1'], return: Promise.resolve(new RateLimiterRes(9, 1000, 1, true)) },
      ]);

      const middleware = createRateLimitMiddleware(keyResolver, rateLimiter);

      await expect(middleware(request, handler)).rejects.toBe(error);

      expect(handlerMocks).toHaveLength(0);
      expect(keyResolverMocks).toHaveLength(0);
      expect(rateLimiterMocks).toHaveLength(0);
    });

    test('with RateLimiterMemory', async () => {
      const request = new ServerRequest('https://example.com');

      const [handler, handlerMocks] = useFunctionMock<Handler>([
        { parameters: [request], return: Promise.resolve(new Response()) },
        { parameters: [request], return: Promise.resolve(new Response()) },
      ]);

      const [keyResolver, keyResolverMocks] = useFunctionMock<KeyResolver>([
        { parameters: [request], return: '203.0.113.1' },
        { parameters: [request], return: '203.0.113.1' },
        { parameters: [request], return: '203.0.113.1' },
      ]);

      const middleware = createRateLimitMiddleware(keyResolver, new RateLimiterMemory({ points: 2, duration: 60 }));

      const response1 = await middleware(request, handler);
      const response2 = await middleware(request, handler);
      const response3 = await middleware(request, handler);

      expect(response1.status).toBe(200);
      expect(response1.headers.get('ratelimit-limit')).toBe('2');
      expect(response1.headers.get('ratelimit-remaining')).toBe('1');
      expect(Number(response1.headers.get('ratelimit-reset'))).toBeLessThanOrEqual(60);
      expect(Number(response1.headers.get('ratelimit-reset'))).toBeGreaterThan(0);
      expect(response2.status).toBe(200);
      expect(response2.headers.get('ratelimit-remaining')).toBe('0');
      expect(response3.status).toBe(429);
      expect(response3.headers.get('ratelimit-remaining')).toBe('0');
      expect(response3.headers.get('retry-after')).not.toBeNull();

      expect(handlerMocks).toHaveLength(0);
      expect(keyResolverMocks).toHaveLength(0);
    });
  });
});
