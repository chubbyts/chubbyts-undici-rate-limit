import { describe, expect, test } from 'vitest';
import { useFunctionMock } from '@chubbyts/chubbyts-function-mock/dist/function-mock';
import { useObjectMock } from '@chubbyts/chubbyts-function-mock/dist/object-mock';
import type { Container } from '@chubbyts/chubbyts-dic-types/dist/container';
import type { ConfigFactory } from '@chubbyts/chubbyts-dic-config/dist/dic-config';
import { createContainerByConfigFactory } from '@chubbyts/chubbyts-dic-config/dist/dic-config';
import type { Handler, Middleware } from '@chubbyts/chubbyts-undici-server/dist/server';
import { Response, ServerRequest } from '@chubbyts/chubbyts-undici-server/dist/server';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import type { KeyResolver } from '../src/key-resolver';
import type { LimitExceededHandler, RateLimiter } from '../src/middleware';
import type { RateLimitConfig } from '../src/service-factory';
import {
  keyResolverServiceFactory,
  limitExceededHandlerServiceFactory,
  rateLimiterServiceFactory,
  rateLimitMiddlewareServiceFactory,
} from '../src/service-factory';

// the create functions return opaque closures, so the wiring gets proven by exercising the created services against
// requests and mocked collaborators (key resolver, rate limiter, limit exceeded handler, handler)

const createRequest = (headers: Record<string, string> = {}, attributes: Record<string, unknown> = {}) =>
  new ServerRequest('https://api.example.com/resource', { headers, attributes });

describe('service-factory', () => {
  describe('keyResolverServiceFactory', () => {
    test('without name, with header and attribute', async () => {
      const rateLimitConfig: RateLimitConfig = {
        keys: [{ header: 'x-api-key' }, { attribute: 'clientIp' }],
        points: 10,
        duration: 60,
      };

      const [container, containerMocks] = useObjectMock<Container>([
        { name: 'get', parameters: ['config'], return: { chubbyts: { rateLimit: rateLimitConfig } } },
      ]);

      const service = keyResolverServiceFactory()(container);

      expect(await service(createRequest({ 'x-api-key': 'key-1' }, { clientIp: '10.0.0.1' }))).toBe('key-1');
      expect(await service(createRequest({}, { clientIp: '10.0.0.1' }))).toBe('10.0.0.1');
      expect(await service(createRequest())).toBeUndefined();

      expect(containerMocks).toHaveLength(0);
    });

    test('without keys', () => {
      const [container, containerMocks] = useObjectMock<Container>([
        {
          name: 'get',
          parameters: ['config'],
          return: { chubbyts: { rateLimit: { keys: [], points: 10, duration: 60 } } },
        },
      ]);

      expect(() => keyResolverServiceFactory()(container)).toThrow(
        'Missing key resolvers at config.chubbyts.rateLimit.keys, expected at least one',
      );

      expect(containerMocks).toHaveLength(0);
    });

    test.each([
      [{ heder: 'x-api-key' }, '{"heder":"x-api-key"}'],
      [{}, '{}'],
      [{ header: 'x-api-key', attribute: 'clientIp' }, '{"header":"x-api-key","attribute":"clientIp"}'],
    ])('with invalid key %j', (key, json) => {
      const [container, containerMocks] = useObjectMock<Container>([
        {
          name: 'get',
          parameters: ['config'],
          return: { chubbyts: { rateLimit: { keys: [{ attribute: 'clientIp' }, key], points: 10, duration: 60 } } },
        },
      ]);

      expect(() => keyResolverServiceFactory()(container)).toThrow(
        `Invalid key resolver ${json} at config.chubbyts.rateLimit.keys[1], expected one of: { "header": string }, { "attribute": string }, { "static": string }`,
      );

      expect(containerMocks).toHaveLength(0);
    });

    test('with keys, the configured order wins', async () => {
      const [container, containerMocks] = useObjectMock<Container>([
        {
          name: 'get',
          parameters: ['config'],
          return: {
            chubbyts: {
              rateLimit: { keys: [{ attribute: 'clientIp' }, { header: 'x-api-key' }], points: 10, duration: 60 },
            },
          },
        },
      ]);

      const service = keyResolverServiceFactory()(container);

      expect(await service(createRequest({ 'x-api-key': 'key-1' }, { clientIp: '10.0.0.1' }))).toBe('10.0.0.1');

      expect(containerMocks).toHaveLength(0);
    });

    test('with keys, static as fallback', async () => {
      const [container, containerMocks] = useObjectMock<Container>([
        {
          name: 'get',
          parameters: ['config'],
          return: {
            chubbyts: {
              rateLimit: { keys: [{ attribute: 'clientIp' }, { static: 'global' }], points: 10, duration: 60 },
            },
          },
        },
      ]);

      const service = keyResolverServiceFactory()(container);

      expect(await service(createRequest({}, { clientIp: '10.0.0.1' }))).toBe('10.0.0.1');
      expect(await service(createRequest())).toBe('global');

      expect(containerMocks).toHaveLength(0);
    });

    test('with keys, only attribute', async () => {
      const [container, containerMocks] = useObjectMock<Container>([
        {
          name: 'get',
          parameters: ['config'],
          return: {
            chubbyts: { rateLimit: { keys: [{ attribute: 'clientIp' }], points: 10, duration: 60 } },
          },
        },
      ]);

      const service = keyResolverServiceFactory()(container);

      expect(await service(createRequest({ 'x-api-key': 'key-1' }, { clientIp: '10.0.0.1' }))).toBe('10.0.0.1');

      expect(containerMocks).toHaveLength(0);
    });

    test('with name', async () => {
      const [container, containerMocks] = useObjectMock<Container>([
        {
          name: 'get',
          parameters: ['config'],
          return: {
            chubbyts: {
              rateLimit: {
                api: { keys: [{ header: 'x-api-key' }], points: 10, duration: 60 },
                login: { keys: [{ attribute: 'userId' }], points: 5, duration: 300 },
              },
            },
          },
        },
      ]);

      const service = keyResolverServiceFactory('login')(container);

      expect(await service(createRequest({ 'x-api-key': 'key-1' }, { userId: 'user-1' }))).toBe('user-1');

      expect(containerMocks).toHaveLength(0);
    });
  });

  describe('rateLimiterServiceFactory', () => {
    test('without name', async () => {
      const rateLimitConfig: RateLimitConfig = { points: 2, duration: 60 };

      const [container, containerMocks] = useObjectMock<Container>([
        { name: 'get', parameters: ['config'], return: { chubbyts: { rateLimit: rateLimitConfig } } },
      ]);

      const service = rateLimiterServiceFactory()(container);

      expect(service).toBeInstanceOf(RateLimiterMemory);
      expect(service.points).toBe(2);
      expect((service as RateLimiterMemory).duration).toBe(60);
      expect((service as RateLimiterMemory).blockDuration).toBe(0);
      expect((service as RateLimiterMemory).keyPrefix).toBe('rlflx');

      expect((await service.consume('key')).remainingPoints).toBe(1);
      expect((await service.consume('key')).remainingPoints).toBe(0);
      await expect(service.consume('key')).rejects.toBeInstanceOf(RateLimiterRes);

      expect(containerMocks).toHaveLength(0);
    });

    test('with name, with options', () => {
      const [container, containerMocks] = useObjectMock<Container>([
        {
          name: 'get',
          parameters: ['config'],
          return: {
            chubbyts: { rateLimit: { login: { points: 5, duration: 300, blockDuration: 900, keyPrefix: 'login' } } },
          },
        },
      ]);

      const service = rateLimiterServiceFactory('login')(container) as RateLimiterMemory;

      expect(service.points).toBe(5);
      expect(service.duration).toBe(300);
      expect(service.blockDuration).toBe(900);
      expect(service.keyPrefix).toBe('login');

      expect(containerMocks).toHaveLength(0);
    });

    test('with name, without keyPrefix, the name is the prefix', () => {
      const [container, containerMocks] = useObjectMock<Container>([
        {
          name: 'get',
          parameters: ['config'],
          return: { chubbyts: { rateLimit: { login: { points: 5, duration: 300 } } } },
        },
      ]);

      const service = rateLimiterServiceFactory('login')(container) as RateLimiterMemory;

      expect(service.keyPrefix).toBe('rlflx:login');

      expect(containerMocks).toHaveLength(0);
    });
  });

  describe('limitExceededHandlerServiceFactory', () => {
    test('without name', async () => {
      const [container, containerMocks] = useObjectMock<Container>([]);

      const service = limitExceededHandlerServiceFactory()(container);

      const response = await service(createRequest(), { limit: 10, remaining: 0, reset: 1 });

      expect(response.status).toBe(429);

      expect(containerMocks).toHaveLength(0);
    });
  });

  describe('rateLimitMiddlewareServiceFactory', () => {
    test('with defaults, without registered services', async () => {
      const config = {
        chubbyts: { rateLimit: { keys: [{ header: 'x-real-ip' }], points: 1, duration: 60 } },
      };

      const [container, containerMocks] = useObjectMock<Container>([
        { name: 'has', parameters: ['rateLimitKeyResolver'], return: false },
        { name: 'get', parameters: ['config'], return: config },
        { name: 'has', parameters: ['rateLimitRateLimiter'], return: false },
        { name: 'get', parameters: ['config'], return: config },
        { name: 'has', parameters: ['rateLimitLimitExceededHandler'], return: false },
      ]);

      const service = rateLimitMiddlewareServiceFactory()(container);

      const request = createRequest({ 'x-real-ip': '203.0.113.1' });

      const [handler, handlerMocks] = useFunctionMock<Handler>([
        { parameters: [request], return: Promise.resolve(new Response()) },
      ]);

      // the shipped factories get used: the configured header gets counted in memory, the default 429 gets served
      const response1 = await service(request, handler);
      const response2 = await service(request, handler);

      expect(response1.status).toBe(200);
      expect(response1.headers.get('ratelimit-limit')).toBe('1');
      expect(response1.headers.get('ratelimit-remaining')).toBe('0');
      expect(response2.status).toBe(429);
      expect(await response2.text()).toBe('Too Many Requests');

      expect(handlerMocks).toHaveLength(0);
      expect(containerMocks).toHaveLength(0);
    });

    test('with registered services', async () => {
      const request = createRequest();
      const response = new Response();

      const [keyResolver, keyResolverMocks] = useFunctionMock<KeyResolver>([{ parameters: [request], return: 'key' }]);
      const [rateLimiter, rateLimiterMocks] = useObjectMock<RateLimiter>([
        { name: 'points', value: 5 },
        { name: 'consume', parameters: ['key'], return: Promise.resolve(new RateLimiterRes(2, 5000, 3, false)) },
      ]);
      const [limitExceededHandler, limitExceededHandlerMocks] = useFunctionMock<LimitExceededHandler>([]);

      const [handler, handlerMocks] = useFunctionMock<Handler>([
        { parameters: [request], return: Promise.resolve(response) },
      ]);

      const [container, containerMocks] = useObjectMock<Container>([
        { name: 'has', parameters: ['rateLimitKeyResolver'], return: true },
        { name: 'get', parameters: ['rateLimitKeyResolver'], return: keyResolver },
        { name: 'has', parameters: ['rateLimitRateLimiter'], return: true },
        { name: 'get', parameters: ['rateLimitRateLimiter'], return: rateLimiter },
        { name: 'has', parameters: ['rateLimitLimitExceededHandler'], return: true },
        { name: 'get', parameters: ['rateLimitLimitExceededHandler'], return: limitExceededHandler },
      ]);

      const service = rateLimitMiddlewareServiceFactory()(container);

      // the registered services win over the shipped factories
      const rateLimitResponse = await service(request, handler);

      expect(rateLimitResponse.status).toBe(200);
      expect(rateLimitResponse.headers.get('ratelimit-limit')).toBe('5');
      expect(rateLimitResponse.headers.get('ratelimit-remaining')).toBe('2');
      expect(rateLimitResponse.headers.get('ratelimit-reset')).toBe('5');

      expect(keyResolverMocks).toHaveLength(0);
      expect(rateLimiterMocks).toHaveLength(0);
      expect(limitExceededHandlerMocks).toHaveLength(0);
      expect(handlerMocks).toHaveLength(0);
      expect(containerMocks).toHaveLength(0);
    });

    test('with name, with registered named services', async () => {
      const request = createRequest();
      const response = new Response(null, { status: 429 });

      const [keyResolver, keyResolverMocks] = useFunctionMock<KeyResolver>([{ parameters: [request], return: 'key' }]);
      const [rateLimiter, rateLimiterMocks] = useObjectMock<RateLimiter>([
        { name: 'points', value: 2 },
        { name: 'consume', parameters: ['key'], return: Promise.reject(new RateLimiterRes(0, 5000, 3, false)) },
      ]);
      const [limitExceededHandler, limitExceededHandlerMocks] = useFunctionMock<LimitExceededHandler>([
        { parameters: [request, { limit: 2, remaining: 0, reset: 5 }], return: Promise.resolve(response) },
      ]);

      const [handler, handlerMocks] = useFunctionMock<Handler>([]);

      const [container, containerMocks] = useObjectMock<Container>([
        { name: 'has', parameters: ['rateLimitKeyResolverlogin'], return: true },
        { name: 'get', parameters: ['rateLimitKeyResolverlogin'], return: keyResolver },
        { name: 'has', parameters: ['rateLimitRateLimiterlogin'], return: true },
        { name: 'get', parameters: ['rateLimitRateLimiterlogin'], return: rateLimiter },
        { name: 'has', parameters: ['rateLimitLimitExceededHandlerlogin'], return: true },
        { name: 'get', parameters: ['rateLimitLimitExceededHandlerlogin'], return: limitExceededHandler },
      ]);

      const service = rateLimitMiddlewareServiceFactory('login')(container);

      const rateLimitResponse = await service(request, handler);

      expect(rateLimitResponse.status).toBe(429);
      expect(rateLimitResponse.headers.get('retry-after')).toBe('5');

      expect(keyResolverMocks).toHaveLength(0);
      expect(rateLimiterMocks).toHaveLength(0);
      expect(limitExceededHandlerMocks).toHaveLength(0);
      expect(handlerMocks).toHaveLength(0);
      expect(containerMocks).toHaveLength(0);
    });
  });

  describe('with container by config', () => {
    test('the services are wired together', async () => {
      const container = createContainerByConfigFactory({
        chubbyts: {
          rateLimit: {
            keys: [{ header: 'x-api-key' }, { attribute: 'clientIp' }],
            points: 2,
            duration: 60,
          } satisfies RateLimitConfig,
        },
        dependencies: {
          factories: new Map<string, ConfigFactory>([
            ['rateLimitMiddleware', rateLimitMiddlewareServiceFactory()],
            ['rateLimitKeyResolver', keyResolverServiceFactory()],
            ['rateLimitRateLimiter', rateLimiterServiceFactory()],
            ['rateLimitLimitExceededHandler', limitExceededHandlerServiceFactory()],
          ]),
        },
      })();

      const rateLimitMiddleware = container.get<Middleware>('rateLimitMiddleware');

      const [handler, handlerMocks] = useFunctionMock<Handler>([
        { callback: async () => new Response() },
        { callback: async () => new Response() },
        { callback: async () => new Response() },
      ]);

      const response1 = await rateLimitMiddleware(createRequest({ 'x-api-key': 'key-1' }), handler);
      const response2 = await rateLimitMiddleware(createRequest({}, { clientIp: 'key-1' }), handler);
      const response3 = await rateLimitMiddleware(createRequest({ 'x-api-key': 'key-1' }), handler);
      const response4 = await rateLimitMiddleware(createRequest({ 'x-api-key': 'key-2' }), handler);

      expect(response1.headers.get('ratelimit-remaining')).toBe('1');
      expect(response2.headers.get('ratelimit-remaining')).toBe('0');
      expect(response3.status).toBe(429);
      expect(response4.status).toBe(200);

      expect(handlerMocks).toHaveLength(0);
    });

    test('the named services are wired together', async () => {
      const container = createContainerByConfigFactory({
        chubbyts: {
          rateLimit: {
            api: { keys: [{ header: 'x-api-key' }], points: 100, duration: 60 },
            login: { keys: [{ header: 'x-api-key' }], points: 1, duration: 300 },
          } satisfies Record<string, RateLimitConfig>,
        },
        dependencies: {
          factories: new Map<string, ConfigFactory>([
            ['rateLimitMiddlewareapi', rateLimitMiddlewareServiceFactory('api')],
            ['rateLimitMiddlewarelogin', rateLimitMiddlewareServiceFactory('login')],
            ['rateLimitKeyResolverapi', keyResolverServiceFactory('api')],
            ['rateLimitKeyResolverlogin', keyResolverServiceFactory('login')],
          ]),
        },
      })();

      const apiMiddleware = container.get<Middleware>('rateLimitMiddlewareapi');
      const loginMiddleware = container.get<Middleware>('rateLimitMiddlewarelogin');

      const [handler, handlerMocks] = useFunctionMock<Handler>([
        { callback: async () => new Response() },
        { callback: async () => new Response() },
        { callback: async () => new Response() },
      ]);

      // each named middleware counts with its own limiter
      const apiResponse1 = await apiMiddleware(createRequest({ 'x-api-key': 'key-1' }), handler);
      const loginResponse1 = await loginMiddleware(createRequest({ 'x-api-key': 'key-1' }), handler);
      const loginResponse2 = await loginMiddleware(createRequest({ 'x-api-key': 'key-1' }), handler);
      const apiResponse2 = await apiMiddleware(createRequest({ 'x-api-key': 'key-1' }), handler);

      expect(apiResponse1.headers.get('ratelimit-limit')).toBe('100');
      expect(apiResponse1.headers.get('ratelimit-remaining')).toBe('99');
      expect(loginResponse1.headers.get('ratelimit-limit')).toBe('1');
      expect(loginResponse1.headers.get('ratelimit-remaining')).toBe('0');
      expect(loginResponse2.status).toBe(429);
      expect(apiResponse2.headers.get('ratelimit-remaining')).toBe('98');

      expect(handlerMocks).toHaveLength(0);
    });
  });
});
