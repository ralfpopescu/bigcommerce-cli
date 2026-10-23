import * as fs from 'fs';
import * as path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MockServer, runCli, STORE_HASH, tempDir, TOKEN } from './support/cli';

let server: MockServer;
let image: string;
beforeAll(async () => {
  server = await new MockServer().start();
  image = path.join(tempDir(), 'photo.png');
  fs.writeFileSync(image, 'not really a png');
});
afterAll(() => server.close());
beforeEach(() => server.reset());

/** One representative per family of command that writes. */
const WRITES: { name: string; args: string[]; method: string; urlEnds: string }[] = [
  { name: 'generated create', args: ['catalog', 'brands', 'create', '--data', '{"name":"X"}'], method: 'POST', urlEnds: '/v3/catalog/brands' },
  { name: 'generated update', args: ['catalog', 'products', 'custom-fields', 'update', '5', '--product-id', '12', '--data', '{"value":"y"}'], method: 'PUT', urlEnds: '/v3/catalog/products/12/custom-fields/5' },
  { name: 'generated delete', args: ['catalog', 'brands', 'delete', '3'], method: 'DELETE', urlEnds: '/v3/catalog/brands/3' },
  { name: 'generated delete-many', args: ['catalog', 'products', 'delete-many', '--query', 'id:in=1,2'], method: 'DELETE', urlEnds: '/v3/catalog/products' },
  { name: 'generated action', args: ['themes', 'activate', '--data', '{"variation_id":"abc","which":"original"}'], method: 'POST', urlEnds: '/v3/themes/actions/activate' },
  { name: 'generated V2 update', args: ['marketing', 'coupons', 'update', '9', '--data', '{"enabled":false}'], method: 'PUT', urlEnds: '/v2/coupons/9' },
  { name: 'hand-written update', args: ['catalog', 'products', 'update', '12', '--data', '{"price":19.99}'], method: 'PUT', urlEnds: '/v3/catalog/products/12' },
  { name: 'hand-written batch', args: ['customers', 'create', '--data', '{"email":"a@b.c"}'], method: 'POST', urlEnds: '/v3/customers' },
  { name: 'hand-written order update', args: ['orders', 'update', '100', '--status', '2'], method: 'PUT', urlEnds: '/v2/orders/100' },
  { name: 'hand-written inventory', args: ['inventory', 'update', '--location-id', '1', '--product-id', '2', '--quantity', '5'], method: 'PUT', urlEnds: '/v3/inventory/adjustments/absolute' },
  { name: 'api POST', args: ['api', 'POST', '/v3/catalog/brands', '--data', '{"name":"X"}'], method: 'POST', urlEnds: '/v3/catalog/brands' },
  { name: 'api DELETE', args: ['api', 'DELETE', '/v3/catalog/brands/1'], method: 'DELETE', urlEnds: '/v3/catalog/brands/1' },
  { name: 'graphql mutation', args: ['graphql', '--query', 'mutation { deleteThing(id: 1) { ok } }'], method: 'POST', urlEnds: '/graphql' },
];

describe('--dry-run', () => {
  for (const w of WRITES) {
    it(`${w.name}: sends nothing and prints the request`, async () => {
      const r = await runCli([...w.args, '--dry-run'], { server });
      expect(r.code, r.stderr).toBe(0);
      expect(server.requests).toHaveLength(0);
      const out = r.json();
      expect(out.dryRun).toBe(true);
      expect(out.method).toBe(w.method);
      expect(out.url.endsWith(w.urlEnds)).toBe(true);
      expect(out.url).toContain(`/stores/${STORE_HASH}/`);
      expect(r.stdout + r.stderr).not.toContain(TOKEN);
    });
  }

  it('includes the body and query', async () => {
    const r = await runCli(['catalog', 'products', 'delete-many', '--query', 'id:in=1,2', '--dry-run'], { server });
    expect(r.json().query).toEqual({ 'id:in': '1,2' });
    const u = await runCli(['catalog', 'products', 'update', '12', '--data', '{"price":19.99}', '--dry-run'], { server });
    expect(u.json().body).toEqual({ price: 19.99 });
  });

  it('multipart lists file paths and field names, not bytes', async () => {
    const r = await runCli(['catalog', 'products', 'images', 'add', '--product-id', '12', '--file', image, '--description', 'Front', '--dry-run'], { server });
    expect(r.code).toBe(0);
    expect(server.requests).toHaveLength(0);
    expect(r.json().multipart).toEqual({ description: 'Front', image_file: { file: image } });
    expect(r.stdout).not.toContain('not really a png');
  });

  it('products update with only images stops at the first upload', async () => {
    const r = await runCli(['catalog', 'products', 'update', '12', '--image-file', image, '--dry-run'], { server });
    expect(r.code).toBe(0);
    expect(server.requests).toHaveLength(0);
    expect(r.json().multipart.image_file).toEqual({ file: image });
  });

  it('payments process (different host) sends nothing', async () => {
    const r = await runCli(['payments', 'process', '--token', 'secret-pat', '--data', '{"payment":{}}', '--dry-run'], {
      server, env: { BIGC_PAYMENTS_URL: server.url },
    });
    expect(r.code).toBe(0);
    expect(server.requests).toHaveLength(0);
    expect(r.stdout).not.toContain('secret-pat');
  });

  it('a GraphQL query is not a write: it runs normally', async () => {
    server.on({ method: 'POST', path: '/graphql', body: { data: { store: { id: 1 } } } });
    const r = await runCli(['graphql', '--query', '{ store { id } }', '--dry-run'], { server });
    expect(r.code).toBe(0);
    expect(r.json()).toEqual({ store: { id: 1 } });
  });

  it('pretty mode shows a readable block', async () => {
    const r = await runCli(['catalog', 'brands', 'delete', '3', '--dry-run', '-o', 'pretty'], { server });
    expect(r.stdout).toContain('Dry run');
    expect(r.stdout).toContain('DELETE');
  });

  it('read-only commands do not take --dry-run', async () => {
    const r = await runCli(['catalog', 'brands', 'list', '--dry-run'], { server });
    expect(r.code).toBe(2);
  });
});

describe('read-only mode', () => {
  for (const w of WRITES) {
    it(`${w.name}: blocked with exit 7 before any request`, async () => {
      const r = await runCli(w.args, { server, env: { BIGC_READ_ONLY: '1' } });
      expect(r.code, r.stderr).toBe(7);
      expect(server.requests).toHaveLength(0);
      expect(r.errorJson().error.type).toBe('blocked');
    });
  }

  it('multipart upload is blocked', async () => {
    const r = await runCli(['catalog', 'products', 'images', 'add', '--product-id', '12', '--file', image], { server, env: { BIGC_READ_ONLY: 'true' } });
    expect(r.code).toBe(7);
    expect(server.requests).toHaveLength(0);
  });

  it('image uploads during products update are blocked, not reported as failed uploads', async () => {
    const r = await runCli(['catalog', 'products', 'update', '12', '--image-url', 'https://x/y.png'], { server, env: { BIGC_READ_ONLY: '1' } });
    expect(r.code).toBe(7);
  });

  it('payments process is blocked', async () => {
    const r = await runCli(['payments', 'process', '--token', 'pat', '--data', '{}'], { server, env: { BIGC_READ_ONLY: '1', BIGC_PAYMENTS_URL: server.url } });
    expect(r.code).toBe(7);
    expect(server.requests).toHaveLength(0);
  });

  it('GET still works', async () => {
    server.on({ method: 'GET', path: '/v3/catalog/brands', body: { data: [{ id: 1 }] } });
    const r = await runCli(['catalog', 'brands', 'list'], { server, env: { BIGC_READ_ONLY: '1' } });
    expect(r.code).toBe(0);
    expect(r.json()).toEqual([{ id: 1 }]);
  });

  it('api GET still works', async () => {
    server.on({ method: 'GET', path: '/v2/store', body: { name: 'Shop' } });
    const r = await runCli(['api', 'GET', '/v2/store'], { server, env: { BIGC_READ_ONLY: '1' } });
    expect(r.code).toBe(0);
  });

  it('--dry-run is still allowed: it sends nothing either way', async () => {
    const r = await runCli(['catalog', 'brands', 'delete', '3', '--dry-run'], { server, env: { BIGC_READ_ONLY: '1' } });
    expect(r.code).toBe(0);
    expect(r.json().dryRun).toBe(true);
    expect(server.requests).toHaveLength(0);
  });

  it('a profile saved with --read-only blocks writes', async () => {
    const configDir = tempDir();
    const login = await runCli(['auth', 'login', '--store-hash', STORE_HASH, '--token', TOKEN, '--read-only'], { configDir, noEnvCredentials: true });
    expect(login.code).toBe(0);
    const saved = JSON.parse(fs.readFileSync(path.join(configDir, 'credentials.json'), 'utf-8'));
    expect(saved.profiles.default.readOnly).toBe(true);

    const blocked = await runCli(['catalog', 'brands', 'delete', '3'], { server, configDir, noEnvCredentials: true });
    expect(blocked.code).toBe(7);
    expect(server.requests).toHaveLength(0);

    const set = await runCli(['auth', 'set', 'default', '--read-only', 'false'], { configDir, noEnvCredentials: true });
    expect(set.code).toBe(0);
    server.on({ method: 'DELETE', path: '/v3/catalog/brands/3', status: 204 });
    const allowed = await runCli(['catalog', 'brands', 'delete', '3'], { server, configDir, noEnvCredentials: true });
    expect(allowed.code).toBe(0);
    expect(server.requests).toHaveLength(1);
  });

  it('auth list --output json never includes the token', async () => {
    const configDir = tempDir();
    await runCli(['auth', 'login', '--store-hash', STORE_HASH, '--token', TOKEN, '--read-only'], { configDir, noEnvCredentials: true });
    const r = await runCli(['auth', 'list'], { configDir, noEnvCredentials: true });
    expect(r.json()).toEqual([{ name: 'default', storeHash: STORE_HASH, active: true, readOnly: true }]);
    expect(r.stdout).not.toContain(TOKEN);
  });
});
