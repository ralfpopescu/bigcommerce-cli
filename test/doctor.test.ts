import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MockServer, runCli, STORE_HASH, TOKEN } from './support/cli';

let server: MockServer;
beforeAll(async () => { server = await new MockServer().start(); });
afterAll(() => server.close());
beforeEach(() => server.reset());

const STORE = { id: STORE_HASH, name: 'Test Shop', domain: 'shop.example.com', secure_url: 'https://shop.example.com', plan_name: 'Plus', plan_level: 'Plus', admin_email: 'owner@example.com' };
const FORBIDDEN = { status: 403, body: { status: 403, title: 'You don\'t have a required scope to access the endpoint' } };

describe('bigc doctor', () => {
  it('reports store info and a mix of ok/forbidden/error probes', async () => {
    server.on(
      { method: 'GET', path: '/v2/store', body: STORE },
      { method: 'GET', path: '/v3/catalog/products', body: { data: [] } },
      { method: 'GET', path: '/v2/orders', status: 204 },
      { method: 'GET', path: '/v3/customers', ...FORBIDDEN },
      { method: 'GET', path: '/v3/content/widgets', body: { data: [] } },
      { method: 'GET', path: '/v3/themes', body: { data: [] } },
      { method: 'GET', path: '/v3/channels', body: { data: [] } },
      { method: 'GET', path: '/v3/inventory/locations', ...FORBIDDEN },
      { method: 'GET', path: '/v2/coupons', status: 500, body: { title: 'oops' } },
      { method: 'GET', path: '/v3/settings/store/locale', body: { data: {} } },
      { method: 'GET', path: '/v3/hooks', body: { data: [] } },
    );
    const r = await runCli(['doctor'], { server });
    expect(r.code, r.stderr).toBe(0);
    const report = r.json();
    expect(report.cli.version).toMatch(/\d+\.\d+\.\d+/);
    expect(report.profile).toEqual({ name: null, source: 'env', storeHash: STORE_HASH, readOnly: false });
    expect(report.store).toMatchObject({ name: 'Test Shop', domain: 'shop.example.com', plan_name: 'Plus' });
    // Only a curated set of store fields; nothing like the owner's email.
    expect(report.store.admin_email).toBeUndefined();
    expect(report.scopes).toEqual({
      catalog: 'ok', orders: 'ok', customers: 'forbidden', content: 'ok', themes: 'ok',
      channels: 'ok', inventory: 'forbidden', marketing: 'error', settings: 'ok', webhooks: 'ok',
    });
    expect(report.scopeNote).toContain('Read');
    expect(r.stdout).not.toContain(TOKEN);
    // Every probe is a GET.
    expect(server.requests.every(q => q.method === 'GET')).toBe(true);
  });

  it('reports read-only mode', async () => {
    server.on({ method: 'GET', path: /.*/, body: { data: [] } });
    const r = await runCli(['doctor'], { server, env: { BIGC_READ_ONLY: '1' } });
    expect(r.json().profile.readOnly).toBe(true);
  });

  it('exits 3 when the credentials work nowhere', async () => {
    server.on({ method: 'GET', path: /.*/, status: 401, body: { status: 401, title: 'Unauthorized' } });
    const r = await runCli(['doctor'], { server });
    expect(r.code).toBe(3);
    expect(r.errorJson().error.type).toBe('auth');
  });

  it('exits 3 with no credentials at all', async () => {
    const r = await runCli(['doctor'], { server, noEnvCredentials: true });
    expect(r.code).toBe(3);
  });

  it('pretty mode prints a readable summary', async () => {
    server.on({ method: 'GET', path: '/v2/store', body: STORE }, { method: 'GET', path: /.*/, body: { data: [] } });
    const r = await runCli(['doctor', '-o', 'pretty'], { server });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Test Shop');
    expect(r.stdout).toContain('catalog');
  });
});
