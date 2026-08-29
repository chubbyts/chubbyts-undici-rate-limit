import { describe, expect, test } from 'vitest';
import { useFunctionMock } from '@chubbyts/chubbyts-function-mock/dist/function-mock';
import { ServerRequest } from '@chubbyts/chubbyts-undici-server/dist/server';
import type { KeyResolver } from '../src/key-resolver';
import {
  createAttributeKeyResolver,
  createHeaderKeyResolver,
  createKeyResolver,
  createStaticKeyResolver,
} from '../src/key-resolver';

describe('key-resolver', () => {
  describe('createHeaderKeyResolver', () => {
    test('without header', () => {
      const request = new ServerRequest('https://example.com');

      expect(createHeaderKeyResolver('x-api-key')(request)).toBeUndefined();
    });

    test('with empty header', () => {
      const request = new ServerRequest('https://example.com', { headers: { 'x-api-key': '' } });

      expect(createHeaderKeyResolver('x-api-key')(request)).toBeUndefined();
    });

    test('with blank header', () => {
      const request = new ServerRequest('https://example.com', { headers: { 'x-api-key': '   ' } });

      expect(createHeaderKeyResolver('x-api-key')(request)).toBeUndefined();
    });

    test('with single value', () => {
      const request = new ServerRequest('https://example.com', { headers: { 'x-real-ip': '203.0.113.1' } });

      expect(createHeaderKeyResolver('X-Real-IP')(request)).toBe('203.0.113.1');
    });

    test('with value, the value is the key as is (no list splitting)', () => {
      const request = new ServerRequest('https://example.com', { headers: { 'x-api-key': ' key,with,commas ' } });

      expect(createHeaderKeyResolver('x-api-key')(request)).toBe('key,with,commas');
    });
  });

  describe('createAttributeKeyResolver', () => {
    test('without attribute', () => {
      const request = new ServerRequest('https://example.com');

      expect(createAttributeKeyResolver('clientIp')(request)).toBeUndefined();
    });

    test('with empty attribute', () => {
      const request = new ServerRequest('https://example.com', { attributes: { clientIp: '' } });

      expect(createAttributeKeyResolver('clientIp')(request)).toBeUndefined();
    });

    test('with non string attribute', () => {
      const request = new ServerRequest('https://example.com', { attributes: { clientIp: 42 } });

      expect(createAttributeKeyResolver('clientIp')(request)).toBeUndefined();
    });

    test('with attribute', () => {
      const request = new ServerRequest('https://example.com', { attributes: { clientIp: '203.0.113.1' } });

      expect(createAttributeKeyResolver('clientIp')(request)).toBe('203.0.113.1');
    });
  });

  describe('createStaticKeyResolver', () => {
    test('with key', () => {
      const request = new ServerRequest('https://example.com');

      expect(createStaticKeyResolver('global')(request)).toBe('global');
    });
  });

  describe('createKeyResolver', () => {
    test('without resolvers', async () => {
      const request = new ServerRequest('https://example.com');

      expect(await createKeyResolver([])(request)).toBeUndefined();
    });

    test('without match', async () => {
      const request = new ServerRequest('https://example.com');

      const [keyResolver1, keyResolver1Mocks] = useFunctionMock<KeyResolver>([
        { parameters: [request], return: undefined },
      ]);

      const [keyResolver2, keyResolver2Mocks] = useFunctionMock<KeyResolver>([
        { parameters: [request], return: undefined },
      ]);

      expect(await createKeyResolver([keyResolver1, keyResolver2])(request)).toBeUndefined();

      expect(keyResolver1Mocks).toHaveLength(0);
      expect(keyResolver2Mocks).toHaveLength(0);
    });

    test('with match, the first key wins', async () => {
      const request = new ServerRequest('https://example.com');

      const [keyResolver1, keyResolver1Mocks] = useFunctionMock<KeyResolver>([
        { parameters: [request], return: undefined },
      ]);

      const [keyResolver2, keyResolver2Mocks] = useFunctionMock<KeyResolver>([
        { parameters: [request], return: '203.0.113.1' },
      ]);

      const [keyResolver3, keyResolver3Mocks] = useFunctionMock<KeyResolver>([]);

      expect(await createKeyResolver([keyResolver1, keyResolver2, keyResolver3])(request)).toBe('203.0.113.1');

      expect(keyResolver1Mocks).toHaveLength(0);
      expect(keyResolver2Mocks).toHaveLength(0);
      expect(keyResolver3Mocks).toHaveLength(0);
    });

    test('with async resolvers', async () => {
      const request = new ServerRequest('https://example.com');

      const [keyResolver1, keyResolver1Mocks] = useFunctionMock<KeyResolver>([
        { parameters: [request], return: Promise.resolve(undefined) },
      ]);

      const [keyResolver2, keyResolver2Mocks] = useFunctionMock<KeyResolver>([
        { parameters: [request], return: Promise.resolve('tenant-1') },
      ]);

      expect(await createKeyResolver([keyResolver1, keyResolver2])(request)).toBe('tenant-1');

      expect(keyResolver1Mocks).toHaveLength(0);
      expect(keyResolver2Mocks).toHaveLength(0);
    });
  });
});
