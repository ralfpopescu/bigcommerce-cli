import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ApiClient } from '../../src/api/client';
import { createClient } from '../../src/api/factory';
import { setProfile } from '../../src/config';
import { fakeFetch, fakeResponse } from '../helpers';

let dir: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bigc-factory-'));
  process.env.BIGC_CONFIG_DIR = dir;
  delete process.env.BIGC_STORE_HASH;
  delete process.env.BIGC_TOKEN;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  process.env = { ...savedEnv };
});

describe('createClient', () => {
  it('builds a client from the active profile', async () => {
    setProfile('default', 'hash-1', 'token-1');

    const http = fakeFetch(fakeResponse({ body: {} }));
    const client = createClient(undefined, { fetch: http.fetch, baseUrl: 'https://x.test' });

    await client.get('v3', 'catalog/products');

    expect(client).toBeInstanceOf(ApiClient);
    expect(http.calls[0]?.url).toBe('https://x.test/hash-1/v3/catalog/products');
    expect(http.calls[0]?.headers['X-Auth-Token']).toBe('token-1');
  });

  it('builds a client from a named profile', async () => {
    setProfile('default', 'hash-1', 'token-1');
    setProfile('staging', 'hash-2', 'token-2');

    const http = fakeFetch(fakeResponse({ body: {} }));

    await createClient('staging', { fetch: http.fetch, baseUrl: 'https://x.test' }).get('v3', 'x');

    expect(http.calls[0]?.url).toContain('hash-2');
  });

  it('builds a client from the environment', async () => {
    process.env.BIGC_STORE_HASH = 'env-hash';
    process.env.BIGC_TOKEN = 'env-token';

    const http = fakeFetch(fakeResponse({ body: {} }));

    await createClient(undefined, { fetch: http.fetch, baseUrl: 'https://x.test' }).get('v3', 'x');

    expect(http.calls[0]?.url).toContain('env-hash');
  });

  it('propagates a missing-profile failure', () => {
    expect(() => createClient('ghost')).toThrow('Profile "ghost" not found');
  });
});
