import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MockServer, runCli } from './support/cli';

let server: MockServer;
beforeAll(async () => { server = await new MockServer().start(); });
afterAll(() => server.close());
beforeEach(() => server.reset());

const ANSI = /\u001b\[/;

function page(n: number, total: number, ids: number[]) {
  return {
    data: ids.map(id => ({ id, name: `p${id}` })),
    meta: { pagination: { current_page: n, total_pages: total, count: ids.length, per_page: 250, total: 6 } },
  };
}

describe('machine-friendly output (stdout is piped in every test)', () => {
  it('list defaults to JSON when piped', async () => {
    server.on({ method: 'GET', path: '/v3/catalog/products', body: page(1, 1, [1, 2]) });
    const r = await runCli(['catalog', 'products', 'list'], { server });
    expect(r.code).toBe(0);
    expect(r.json()).toEqual([{ id: 1, name: 'p1' }, { id: 2, name: 'p2' }]);
    expect(r.stdout).not.toMatch(ANSI);
    expect(r.stderr).toBe('');
  });

  it('get prints the unwrapped record', async () => {
    server.on({ method: 'GET', path: '/v3/catalog/brands/7', body: { data: { id: 7, name: 'Acme' } } });
    const r = await runCli(['catalog', 'brands', 'get', '7'], { server });
    expect(r.json()).toEqual({ id: 7, name: 'Acme' });
  });

  it('create prints only the created record — the success line is not mixed in', async () => {
    server.on({ method: 'POST', path: '/v3/catalog/brands', body: { data: { id: 8, name: 'New' } } });
    const r = await runCli(['catalog', 'brands', 'create', '--data', '{"name":"New"}'], { server });
    expect(r.code).toBe(0);
    expect(r.json()).toEqual({ id: 8, name: 'New' });
  });

  it('delete (204) prints an ok object', async () => {
    server.on({ method: 'DELETE', path: '/v3/catalog/brands/8', status: 204 });
    const r = await runCli(['catalog', 'brands', 'delete', '8'], { server });
    expect(r.code).toBe(0);
    expect(r.json()).toMatchObject({ ok: true });
  });

  it('api 204 prints {"ok":true,"status":204}', async () => {
    server.on({ method: 'DELETE', path: '/v3/catalog/brands/8', status: 204 });
    const r = await runCli(['api', 'DELETE', '/v3/catalog/brands/8'], { server });
    expect(r.json()).toMatchObject({ ok: true, status: 204 });
  });

  it('hand-written delete prints an ok object too', async () => {
    server.on({ method: 'DELETE', path: '/v3/catalog/products/3', status: 204 });
    const r = await runCli(['catalog', 'products', 'delete', '3'], { server });
    expect(r.json()).toMatchObject({ ok: true, message: 'Product 3 deleted' });
  });

  it('--all prints one JSON array across pages', async () => {
    server.on(
      { method: 'GET', path: '/v3/catalog/products', times: 1, body: page(1, 3, [1, 2]) },
      { method: 'GET', path: '/v3/catalog/products', times: 1, body: page(2, 3, [3, 4]) },
      { method: 'GET', path: '/v3/catalog/products', times: 1, body: page(3, 3, [5, 6]) },
    );
    const r = await runCli(['catalog', 'products', 'list', '--all'], { server });
    expect(r.json().map((p: { id: number }) => p.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(server.requests.map(q => q.query.page)).toEqual(['1', '2', '3']);
  });

  it('--all --ndjson streams one record per line across 3 pages', async () => {
    server.on(
      { method: 'GET', path: '/v3/catalog/products', times: 1, body: page(1, 3, [1, 2]) },
      { method: 'GET', path: '/v3/catalog/products', times: 1, body: page(2, 3, [3, 4]) },
      { method: 'GET', path: '/v3/catalog/products', times: 1, body: page(3, 3, [5, 6]) },
    );
    const r = await runCli(['catalog', 'products', 'list', '--all', '--ndjson'], { server });
    expect(r.code).toBe(0);
    const lines = r.stdout.trim().split('\n');
    expect(lines).toHaveLength(6);
    expect(lines.map(l => JSON.parse(l).id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('--ndjson works on generated V2 lists', async () => {
    server.on(
      { method: 'GET', path: '/v2/coupons', times: 1, body: Array.from({ length: 250 }, (_, i) => ({ id: i })) },
      { method: 'GET', path: '/v2/coupons', times: 1, body: [{ id: 250 }] },
    );
    const r = await runCli(['marketing', 'coupons', 'list', '--all', '--ndjson'], { server });
    expect(r.code).toBe(0);
    expect(r.stdout.trim().split('\n')).toHaveLength(251);
  });

  it('BIGC_OUTPUT=table is honoured, and --output beats it', async () => {
    server.on({ method: 'GET', path: '/v3/catalog/brands', body: page(1, 1, [1]) });
    const table = await runCli(['catalog', 'brands', 'list'], { server, env: { BIGC_OUTPUT: 'table' } });
    expect(table.stdout).toContain('p1');
    expect(() => JSON.parse(table.stdout)).toThrow();

    const json = await runCli(['catalog', 'brands', 'list', '-o', 'json'], { server, env: { BIGC_OUTPUT: 'table' } });
    expect(json.json()).toEqual([{ id: 1, name: 'p1' }]);
  });

  it('an unknown output format is a usage error', async () => {
    const r = await runCli(['catalog', 'brands', 'list', '-o', 'yaml'], { server });
    expect(r.code).toBe(2);
  });
});
