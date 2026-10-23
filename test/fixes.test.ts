import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MockServer, runCli } from './support/cli';

let server: MockServer;
beforeAll(async () => { server = await new MockServer().start(); });
afterAll(() => server.close());
beforeEach(() => server.reset());

describe('collection deletes that take no filters', () => {
  it('orders delete-many offers no filters and always needs --yes', async () => {
    const help = await runCli(['orders', 'delete-many', '--help']);
    expect(help.stdout).not.toContain('--status-id');
    expect(help.stdout).not.toContain('--query');

    const filtered = await runCli(['orders', 'delete-many', '--status-id', '5'], { server });
    expect(filtered.code).toBe(2);

    const bare = await runCli(['orders', 'delete-many'], { server });
    expect(bare.code).toBe(2);
    expect(bare.errorJson().error.title).toContain('takes no filters');
    expect(server.requests).toHaveLength(0);
  });

  it('orders delete-many --dry-run shows the request without --yes', async () => {
    const r = await runCli(['orders', 'delete-many', '--dry-run'], { server });
    expect(r.code).toBe(0);
    expect(r.json()).toMatchObject({ dryRun: true, method: 'DELETE' });
    expect(server.requests).toHaveLength(0);
  });

  it('filterable delete-many still accepts --query without --yes', async () => {
    server.on({ method: 'DELETE', path: '/v3/catalog/products', status: 204 });
    const r = await runCli(['catalog', 'products', 'delete-many', '--query', 'id:in=1,2'], { server });
    expect(r.code).toBe(0);
    expect(server.requests[0].query).toEqual({ 'id:in': '1,2' });
  });
});

describe('batch deletes', () => {
  it('batch metafield delete sends the IDs as a JSON array body', async () => {
    server.on({ method: 'DELETE', path: '/v3/customers/metafields', status: 204 });
    const r = await runCli(['customers', 'all-metafields', 'delete', '101,102'], { server });
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(server.requests[0].body)).toEqual([101, 102]);
    expect(server.requests[0].query).toEqual({});
  });

  it('channel-assignments delete can be narrowed to one channel', async () => {
    server.on({ method: 'DELETE', path: '/v3/catalog/products/channel-assignments', status: 204 });
    const r = await runCli(['catalog', 'channel-assignments', 'delete', '12', '--query', 'channel_id:in=3'], { server });
    expect(r.code, r.stderr).toBe(0);
    expect(server.requests[0].query).toEqual({ 'product_id:in': '12', 'channel_id:in': '3' });
  });
});

describe('webhooks', () => {
  it('create takes its fields from --data, not list filters', async () => {
    const help = await runCli(['webhooks', 'create', '--help']);
    expect(help.stdout).not.toContain('--scope');
    expect(help.stdout).not.toContain('--destination');
  });
});
