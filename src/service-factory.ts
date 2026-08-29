import type { Container } from '@chubbyts/chubbyts-dic-types/dist/container';
import { createAbstractFactory } from '@chubbyts/chubbyts-dic-config-factory/dist/dic-config-factory';
import type { Middleware } from '@chubbyts/chubbyts-undici-server/dist/server';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import type { KeyResolver } from './key-resolver.js';
import {
  createAttributeKeyResolver,
  createHeaderKeyResolver,
  createKeyResolver,
  createStaticKeyResolver,
} from './key-resolver.js';
import type { LimitExceededHandler, RateLimiter } from './middleware.js';
import { createDefaultLimitExceededHandler, createRateLimitMiddleware } from './middleware.js';

/**
 * One key resolver, see `createHeaderKeyResolver`, `createAttributeKeyResolver` and `createStaticKeyResolver`.
 */
export type KeyResolverConfig =
  /** a header name, e.g. `x-api-key` (not `x-forwarded-for`, see `createHeaderKeyResolver`) */
  | { header: string }
  /** an attribute name, e.g. `clientIp` set by @chubbyts/chubbyts-undici-trusted-proxy */
  | { attribute: string }
  /** a fixed key for every request, e.g. `global` as the last entry so that requests without key share one limit */
  | { static: string };

/**
 * The configuration read by the service factories from `config.chubbyts.rateLimit` (or
 * `config.chubbyts.rateLimit.<name>` for named factories), see the options of rate-limiter-flexible's
 * `RateLimiterMemory`.
 */
export type RateLimitConfig = {
  /** the key resolvers in order (first resolved key wins), the last one should resolve for every request */
  keys: Array<KeyResolverConfig>;
  /** maximum of requests per duration */
  points: number;
  /** seconds before the consumed points get reset, 0 never resets */
  duration: number;
  /** seconds a key gets blocked once it exceeded the points, 0 (default) does not block */
  blockDuration?: number;
  /** prefix of the keys within the store, defaults to `rlflx` (or `rlflx:<name>` for named factories) */
  keyPrefix?: string;
};

type Config = {
  chubbyts: {
    rateLimit: RateLimitConfig | Record<string, RateLimitConfig>;
  };
};

const keyResolverFactories: Record<string, (name: string) => KeyResolver> = {
  header: createHeaderKeyResolver,
  attribute: createAttributeKeyResolver,
  static: createStaticKeyResolver,
};

const createKeyResolverByConfig = (keyResolverConfig: KeyResolverConfig, path: string): KeyResolver => {
  const entries = Object.entries(keyResolverConfig);

  // an unknown key (e.g. a typo) would otherwise silently disable the rate limiting
  if (entries.length !== 1 || !(entries[0][0] in keyResolverFactories)) {
    throw new Error(
      `Invalid key resolver ${JSON.stringify(keyResolverConfig)} at ${path}, expected one of: ${Object.keys(
        keyResolverFactories,
      )
        .map((type) => `{ "${type}": string }`)
        .join(', ')}`,
    );
  }

  const [type, name] = entries[0];

  return keyResolverFactories[type](name);
};

export const keyResolverServiceFactory = createAbstractFactory(
  (container: Container, { resolveConfig }): KeyResolver => {
    const { keys } = resolveConfig(container.get<Config>('config').chubbyts.rateLimit);

    // without any key the middleware would fail for every request
    if (keys.length === 0) {
      throw new Error('Missing key resolvers at config.chubbyts.rateLimit.keys, expected at least one');
    }

    return createKeyResolver(
      keys.map((keyResolverConfig, index) =>
        createKeyResolverByConfig(keyResolverConfig, `config.chubbyts.rateLimit.keys[${index}]`),
      ),
    );
  },
);

export const rateLimiterServiceFactory = createAbstractFactory(
  (container: Container, { name, resolveConfig }): RateLimiter => {
    const { points, duration, blockDuration, keyPrefix } = resolveConfig(
      container.get<Config>('config').chubbyts.rateLimit,
    );

    // named limiters sharing one store (e.g. a redis) must not share their counters
    return new RateLimiterMemory({
      points,
      duration,
      blockDuration,
      keyPrefix: keyPrefix ?? (name ? `rlflx:${name}` : undefined),
    });
  },
);

export const limitExceededHandlerServiceFactory = createAbstractFactory((): LimitExceededHandler => {
  return createDefaultLimitExceededHandler();
});

export const rateLimitMiddlewareServiceFactory = createAbstractFactory(
  (container: Container, { resolveDependency }): Middleware => {
    // a registered service wins over the shipped factory, so that any part can be replaced (e.g. a RateLimiterRedis)
    // or shared between services
    return createRateLimitMiddleware(
      resolveDependency(container, 'rateLimitKeyResolver', keyResolverServiceFactory),
      resolveDependency(container, 'rateLimitRateLimiter', rateLimiterServiceFactory),
      resolveDependency(container, 'rateLimitLimitExceededHandler', limitExceededHandlerServiceFactory),
    );
  },
);
