# chubbyts-undici-rate-limit

[![CI](https://github.com/chubbyts/chubbyts-undici-rate-limit/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/chubbyts/chubbyts-undici-rate-limit/actions/workflows/ci.yml)
[![Coverage Status](https://coveralls.io/repos/github/chubbyts/chubbyts-undici-rate-limit/badge.svg?branch=master)](https://coveralls.io/github/chubbyts/chubbyts-undici-rate-limit?branch=master)
[![Mutation testing badge](https://img.shields.io/endpoint?style=flat&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Fchubbyts%2Fchubbyts-undici-rate-limit%2Fmaster)](https://dashboard.stryker-mutator.io/reports/github.com/chubbyts/chubbyts-undici-rate-limit/master)
[![npm-version](https://img.shields.io/npm/v/@chubbyts/chubbyts-undici-rate-limit.svg)](https://www.npmjs.com/package/@chubbyts/chubbyts-undici-rate-limit)

[![bugs](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-undici-rate-limit&metric=bugs)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-undici-rate-limit)
[![code_smells](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-undici-rate-limit&metric=code_smells)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-undici-rate-limit)
[![coverage](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-undici-rate-limit&metric=coverage)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-undici-rate-limit)
[![duplicated_lines_density](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-undici-rate-limit&metric=duplicated_lines_density)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-undici-rate-limit)
[![ncloc](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-undici-rate-limit&metric=ncloc)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-undici-rate-limit)
[![sqale_rating](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-undici-rate-limit&metric=sqale_rating)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-undici-rate-limit)
[![alert_status](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-undici-rate-limit&metric=alert_status)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-undici-rate-limit)
[![reliability_rating](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-undici-rate-limit&metric=reliability_rating)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-undici-rate-limit)
[![security_rating](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-undici-rate-limit&metric=security_rating)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-undici-rate-limit)
[![sqale_index](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-undici-rate-limit&metric=sqale_index)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-undici-rate-limit)
[![vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-undici-rate-limit&metric=vulnerabilities)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-undici-rate-limit)

## Description

A minimal rate limiting middleware for chubbyts-undici-server.

## Requirements

 * node: >=22
 * [@chubbyts/chubbyts-dic-config-factory][5]: ^1.0.0
 * [@chubbyts/chubbyts-dic-types][3]: ^2.3.0
 * [@chubbyts/chubbyts-undici-server][2]: ^1.2.0
 * [rate-limiter-flexible][6]: ^11.2.0

## Installation

Through [NPM](https://www.npmjs.com) as [@chubbyts/chubbyts-undici-rate-limit][1].

```ts
npm i @chubbyts/chubbyts-undici-rate-limit@^1.0.0
```

## Usage

The middleware is a thin layer on top of [rate-limiter-flexible][6]: it resolves the key of a request (usually the
client ip), consumes one point from a `RateLimiter*` and translates the result into the `ratelimit-limit`,
`ratelimit-remaining` and `ratelimit-reset` (seconds) headers, or into a `429 Too Many Requests` (plus `retry-after`)
once the limiter rejects. With `duration: 0` (the limit never resets) `ratelimit-reset` and `retry-after` are omitted.

The header names follow the widely supported earlier drafts of [draft-ietf-httpapi-ratelimit-headers][8] (separate
`ratelimit-*` headers); the current drafts fold them into a single structured `ratelimit` header, which is not
supported by most clients yet.

```ts
import {
  createAttributeKeyResolver,
  createHeaderKeyResolver,
  createKeyResolver,
} from '@chubbyts/chubbyts-undici-rate-limit/dist/key-resolver';
import { createRateLimitMiddleware } from '@chubbyts/chubbyts-undici-rate-limit/dist/middleware';
import { Handler, Response, ServerRequest } from '@chubbyts/chubbyts-undici-server/dist/server';
import { RateLimiterMemory } from 'rate-limiter-flexible';

const rateLimitMiddleware = createRateLimitMiddleware(
  // the first resolved key wins, the last resolver should resolve a key for every request
  createKeyResolver([createAttributeKeyResolver('clientIp'), createHeaderKeyResolver('x-api-key')]),
  // 100 requests per 60 seconds, see rate-limiter-flexible for blockDuration, RateLimiterRedis, RateLimiterMongo, ...
  new RateLimiterMemory({ points: 100, duration: 60 }),
);

const handler: Handler = async (serverRequest: ServerRequest) => {
  return new Response();
};

(async () => {
  const serverRequest = new ServerRequest('https://example.com');
  const response = await rateLimitMiddleware(serverRequest, handler);
})();
```

### Client ip behind a proxy

The middleware does **not** parse `x-forwarded-for` (or any other forwarded header) itself: every proxy *appends* the
address it saw, so the first entry is whatever the client sent, and any client could pick its own key (and thereby its
own limit). Use [@chubbyts/chubbyts-undici-trusted-proxy][7] in front of this middleware instead: it decides which
entries of the forwarded headers to trust and sets the `clientIp` attribute, which `createAttributeKeyResolver('clientIp')`
reads.

```ts
import { createForwardedResolver, createTrustedProxyMiddleware } from '@chubbyts/chubbyts-undici-trusted-proxy/dist/middleware';

// the ips / cidrs of the proxies, see @chubbyts/chubbyts-undici-trusted-proxy
const trustedProxyMiddleware = createTrustedProxyMiddleware(createForwardedResolver(['10.0.0.0/8', '::1']));

// the trusted proxy middleware must run before the rate limit middleware
const middlewares = [trustedProxyMiddleware, rateLimitMiddleware];
```

`createHeaderKeyResolver` is meant for headers the client legitimately owns, like an `x-api-key` (the header value is
the key as is), not for forwarded headers. Keep in mind that a client who simply omits such a header gets no key and thereby passes unlimited: either
chain a resolver with a key every request has (e.g. `createAttributeKeyResolver('clientIp')`, or as a last resort
`createStaticKeyResolver('global')`, which puts all remaining requests into one shared limit) behind it, or reject
requests without the header before this middleware.

The key space should not be under the control of the client: every distinct key allocates its own counter in the
limiter (for `RateLimiterMemory` a record plus a timer per key until the duration ends). A resolver which lets a
client pick arbitrary keys (like a freely spoofable header) lets it grow the memory of the limiter without bound.

A `KeyResolver` may be async (e.g. to map an api key to a tenant). The middleware fails closed: a request without a
resolved key (no matching header / attribute) is treated as a misconfiguration and fails with an error instead of
passing unlimited, as do errors of the limiter (e.g. an unreachable redis; use the `insuranceLimiter` option of
[rate-limiter-flexible][6] to fall back to another limiter). To exempt requests from the rate limit, do not run the
middleware for them (e.g. register it per route or route group).

### Shared limits between processes

`RateLimiterMemory` counts within a single process. Pass any other limiter of [rate-limiter-flexible][6]
(`RateLimiterRedis`, `RateLimiterMongo`, `RateLimiterPostgres`, ...) to share the limits:

```ts
import { RateLimiterMongo } from 'rate-limiter-flexible';

const rateLimiter = new RateLimiterMongo({ storeClient: mongoClient, points: 100, duration: 60 });
```

### Custom limit exceeded response

The third argument replaces the default `429` response, e.g. to return a problem json:

```ts
import type { LimitExceededHandler } from '@chubbyts/chubbyts-undici-rate-limit/dist/middleware';

const limitExceededHandler: LimitExceededHandler = async (request, { limit, reset }) => {
  return new Response(JSON.stringify({ title: 'Too Many Requests', detail: `Limit of ${limit} reached, retry in ${reset}s` }), {
    status: 429,
    headers: { 'content-type': 'application/problem+json' },
  });
};

const rateLimitMiddleware = createRateLimitMiddleware(keyResolver, rateLimiter, limitExceededHandler);
```

### Service factories (chubbyts-dic-config)

The package ships service factories (abstract factories built on [chubbyts-dic-config-factory][5]) for a [chubbyts-dic-config][4] (or any [chubbyts-dic-types][3] compatible) container within `@chubbyts/chubbyts-undici-rate-limit/dist/service-factory`, configured through `config.chubbyts.rateLimit`:

```ts
import type { ConfigFactory } from '@chubbyts/chubbyts-dic-config/dist/dic-config';
import { createContainerByConfigFactory } from '@chubbyts/chubbyts-dic-config/dist/dic-config';
import type { RateLimitConfig } from '@chubbyts/chubbyts-undici-rate-limit/dist/service-factory';
import { rateLimitMiddlewareServiceFactory } from '@chubbyts/chubbyts-undici-rate-limit/dist/service-factory';
import type { Middleware } from '@chubbyts/chubbyts-undici-server/dist/server';

const container = createContainerByConfigFactory({
  chubbyts: {
    rateLimit: {
      // the key resolvers in order, the first resolved key wins
      keys: [
        // the clientIp attribute set by @chubbyts/chubbyts-undici-trusted-proxy (registered before this middleware)
        { attribute: 'clientIp' },
        // a header name, e.g. an api key (not x-forwarded-for, see "Client ip behind a proxy")
        { header: 'x-api-key' },
        // a fixed key for all remaining requests (one shared limit instead of no limit), optional
        { static: 'global' },
      ],
      points: 100,
      duration: 60,
      // blockDuration: 0,
      // keyPrefix: 'rlflx', ('rlflx:<name>' for named factories, see below)
    } satisfies RateLimitConfig,
  },
  dependencies: {
    factories: new Map<string, ConfigFactory>([['rateLimitMiddleware', rateLimitMiddlewareServiceFactory()]]),
  },
})();

const rateLimitMiddleware = container.get<Middleware>('rateLimitMiddleware');
```

The `rateLimitMiddlewareServiceFactory` uses the services `rateLimitKeyResolver`, `rateLimitRateLimiter` and `rateLimitLimitExceededHandler` of the container if registered, and creates them through the shipped `keyResolverServiceFactory`, `rateLimiterServiceFactory` (a `RateLimiterMemory`) and `limitExceededHandlerServiceFactory` otherwise. Register any of them under its name to replace it (e.g. a `RateLimiterMongo` as `rateLimitRateLimiter`) or to share it with other services.

#### With names

To serve different parts of an api with different limits, the same factories can be registered multiple times with a name: the config is then read from `config.chubbyts.rateLimit.<name>` and the name gets appended to each service id (`rateLimitMiddlewareapi`, `rateLimitRateLimiterapi`, ...).

```ts
const container = createContainerByConfigFactory({
  chubbyts: {
    rateLimit: {
      api: { keys: [{ attribute: 'clientIp' }], points: 1000, duration: 60 },
      login: { keys: [{ attribute: 'clientIp' }], points: 5, duration: 300, blockDuration: 900 },
    } satisfies Record<string, RateLimitConfig>,
  },
  dependencies: {
    factories: new Map<string, ConfigFactory>([
      ['rateLimitMiddlewareapi', rateLimitMiddlewareServiceFactory('api')],
      ['rateLimitMiddlewarelogin', rateLimitMiddlewareServiceFactory('login')],
    ]),
  },
})();

const apiRateLimitMiddleware = container.get<Middleware>('rateLimitMiddlewareapi');
const loginRateLimitMiddleware = container.get<Middleware>('rateLimitMiddlewarelogin');
```

Without an explicit `keyPrefix` a named limiter uses `rlflx:<name>`, so that named limiters sharing one store (e.g. a
redis) do not share their counters.

## Copyright

2026 Dominik Zogg

[1]: https://www.npmjs.com/package/@chubbyts/chubbyts-undici-rate-limit
[2]: https://www.npmjs.com/package/@chubbyts/chubbyts-undici-server
[3]: https://www.npmjs.com/package/@chubbyts/chubbyts-dic-types
[4]: https://www.npmjs.com/package/@chubbyts/chubbyts-dic-config
[5]: https://www.npmjs.com/package/@chubbyts/chubbyts-dic-config-factory
[6]: https://www.npmjs.com/package/rate-limiter-flexible
[7]: https://www.npmjs.com/package/@chubbyts/chubbyts-undici-trusted-proxy
[8]: https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/
