import type { ServerRequest } from '@chubbyts/chubbyts-undici-server/dist/server';

/**
 * Resolves the key a request gets counted under (usually the client ip), `undefined` means "not resolved" (the next
 * resolver of a `createKeyResolver` chain gets asked, the middleware fails if none resolves). May be async, e.g. to
 * map an api key to a tenant.
 */
export type KeyResolver = (request: ServerRequest) => string | undefined | Promise<string | undefined>;

/**
 * Resolves the key from the given (case insensitive) header, e.g. `x-api-key`. The header value is the key as is
 * (`Headers` already strips surrounding whitespace), empty headers get ignored.
 *
 * Do not use it for forwarded headers like `x-forwarded-for`: every proxy *appends* the address it saw, so the first
 * entry is whatever the client sent (freely spoofable). Use @chubbyts/chubbyts-undici-trusted-proxy in front and
 * `createAttributeKeyResolver('clientIp')` instead.
 */
export const createHeaderKeyResolver = (name: string): KeyResolver => {
  return (request: ServerRequest): string | undefined => {
    return request.headers.get(name) || undefined;
  };
};

/**
 * Resolves the key from the given request attribute, e.g. the `clientIp` set by
 * @chubbyts/chubbyts-undici-trusted-proxy or a `userId` set by an authentication middleware. Non string / empty
 * attributes get ignored.
 */
export const createAttributeKeyResolver = (name: string): KeyResolver => {
  return (request: ServerRequest): string | undefined => {
    const value = request.attributes[name];

    return typeof value === 'string' && value !== '' ? value : undefined;
  };
};

/**
 * Resolves the given key for every request, e.g. `global` as the last resolver of a chain: requests without any
 * other key then share one (global) limit instead of passing unlimited.
 */
export const createStaticKeyResolver = (key: string): KeyResolver => {
  return (): string => key;
};

/**
 * Chains the given resolvers, the first resolved key wins.
 */
export const createKeyResolver = (keyResolvers: Array<KeyResolver>): KeyResolver => {
  return async (request: ServerRequest): Promise<string | undefined> => {
    for (const keyResolver of keyResolvers) {
      const key = await keyResolver(request);

      if (key !== undefined) {
        return key;
      }
    }

    return undefined;
  };
};
