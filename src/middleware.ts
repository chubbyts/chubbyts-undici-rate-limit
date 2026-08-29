import type { Handler, Middleware, ServerRequest } from '@chubbyts/chubbyts-undici-server/dist/server';
import { Response } from '@chubbyts/chubbyts-undici-server/dist/server';
import type { RateLimiterAbstract, RateLimiterRes } from 'rate-limiter-flexible';
import type { KeyResolver } from './key-resolver.js';

/**
 * The subset of a rate-limiter-flexible limiter (`RateLimiterMemory`, `RateLimiterRedis`, `RateLimiterMongo`, ...)
 * the middleware relies on.
 */
export type RateLimiter = Pick<RateLimiterAbstract, 'points' | 'consume'>;

export type RateLimitInfo = {
  /** the configured maximum of requests (points) per duration */
  limit: number;
  /** requests left within the current duration, 0 when exceeded */
  remaining: number;
  /** seconds until the current duration (or block) ends (rounded up), `undefined` if it never ends (`duration: 0`) */
  reset: number | undefined;
};

/**
 * Creates the response for a request that exceeded the limit, the rate limit headers get added afterwards.
 */
export type LimitExceededHandler = (request: ServerRequest, info: RateLimitInfo) => Promise<Response>;

export const createDefaultLimitExceededHandler = (): LimitExceededHandler => {
  return async (): Promise<Response> => {
    return new Response('Too Many Requests', {
      status: 429,
      statusText: 'Too Many Requests',
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  };
};

// rate-limiter-flexible reports -1 for a key that never expires (duration 0)
const toInfo = (limit: number, { remainingPoints, msBeforeNext }: RateLimiterRes): RateLimitInfo => ({
  limit,
  remaining: remainingPoints,
  reset: msBeforeNext < 0 ? undefined : Math.ceil(msBeforeNext / 1000),
});

const toRateLimitHeaders = (exceeded: boolean, { limit, remaining, reset }: RateLimitInfo): Array<[string, string]> => [
  ['ratelimit-limit', limit.toString()],
  ['ratelimit-remaining', remaining.toString()],
  ...(reset !== undefined ? [['ratelimit-reset', reset.toString()] as [string, string]] : []),
  // retry-after is only meaningful on a rejected response (rfc 9110) and a client should wait at least a second
  ...(exceeded && reset !== undefined ? [['retry-after', Math.max(1, reset).toString()] as [string, string]] : []),
];

const withRateLimitHeaders = (response: Response, exceeded: boolean, info: RateLimitInfo): Response => {
  const rateLimitHeaders = toRateLimitHeaders(exceeded, info);

  try {
    // set (not append) replaces existing rate limit headers (e.g. set by the handler), otherwise their values would
    // get comma joined, all other headers (e.g. multiple set-cookie) stay untouched
    for (const [name, value] of rateLimitHeaders) {
      response.headers.set(name, value);
    }

    return response;
  } catch {
    // immutable headers (Response.redirect(), Response.error()): rebuild the response with the same body
    const rateLimitHeaderNames = new Set(rateLimitHeaders.map(([name]) => name));

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: [
        ...[...response.headers.entries()].filter(([name]) => !rateLimitHeaderNames.has(name)),
        ...rateLimitHeaders,
      ],
    });
  }
};

// duck typed instead of `instanceof RateLimiterRes`, so that a second copy of rate-limiter-flexible (version mismatch)
// still results in a 429 instead of a 500, but never an Error (which carries a stack) so that a real error with
// matching properties does not get swallowed into a 429
const isRateLimiterRes = (e: unknown): e is RateLimiterRes =>
  typeof e === 'object' &&
  e !== null &&
  !(e instanceof Error) &&
  typeof (e as RateLimiterRes).remainingPoints === 'number' &&
  typeof (e as RateLimiterRes).msBeforeNext === 'number' &&
  typeof (e as RateLimiterRes).consumedPoints === 'number';

const consume = async (rateLimiter: RateLimiter, key: string): Promise<{ exceeded: boolean; info: RateLimitInfo }> => {
  const { points } = rateLimiter;

  try {
    return { exceeded: false, info: toInfo(points, await rateLimiter.consume(key)) };
  } catch (e) {
    // the limiter rejects with a RateLimiterRes when the limit is exceeded, anything else is a real error
    if (!isRateLimiterRes(e)) {
      throw e;
    }

    return { exceeded: true, info: toInfo(points, e) };
  }
};

/**
 * Consumes one point per request from the `rateLimiter` under the key of the `keyResolver` and answers with the
 * `limitExceededHandler` once the limiter rejects. Every response carries the
 * `ratelimit-limit`, `ratelimit-remaining` and `ratelimit-reset` headers, an exceeded one `retry-after` (the reset
 * ones only if the limit resets at all, see `RateLimitInfo`).
 *
 * A request without key (the `keyResolver` returned `undefined`) is a misconfiguration and fails with an error, instead
 * of silently passing unlimited: chain a resolver with a key every request has (e.g. the `clientIp` attribute) behind
 * the optional ones, or skip the middleware for such requests. Any other error of the limiter (e.g. an unreachable
 * redis) gets rethrown as well (fail closed), wrap the limiter (or use the `insuranceLimiter` option of
 * rate-limiter-flexible) to fail open instead.
 */
export const createRateLimitMiddleware = (
  keyResolver: KeyResolver,
  rateLimiter: RateLimiter,
  limitExceededHandler: LimitExceededHandler = createDefaultLimitExceededHandler(),
): Middleware => {
  return async (request: ServerRequest, handler: Handler): Promise<Response> => {
    const key = await keyResolver(request);

    if (key === undefined) {
      throw new Error(
        `Missing rate limit key for ${request.method} ${request.url}: the key resolver resolved no key, chain a resolver with a key every request has (e.g. the "clientIp" attribute)`,
      );
    }

    const { exceeded, info } = await consume(rateLimiter, key);

    const response = await (exceeded ? limitExceededHandler(request, info) : handler(request));

    return withRateLimitHeaders(response, exceeded, info);
  };
};
