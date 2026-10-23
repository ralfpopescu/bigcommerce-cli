import * as fs from 'fs';
import * as path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MockServer, runCli, tempDir, TOKEN } from './support/cli';

let server: MockServer;
beforeAll(async () => { server = await new MockServer().start(); });
afterAll(() => server.close());
beforeEach(() => server.reset());

const QUERY = '{ site { products(first: 1) { edges { node { entityId } } } } }';
const DATA = { site: { products: { edges: [{ node: { entityId: 77 } }] } } };

// The mock answers storefront /graphql on the same host, so --domain points there.
const sf = (...args: string[]) => ['storefront', 'graphql', '--domain', server.url, ...args];

describe('bigc storefront graphql', () => {
  it('runs a query with a given token', async () => {
    server.on({ method: 'POST', path: '/graphql', body: { data: DATA } });
    const r = await runCli(sf('--query', QUERY, '--token', 'sf-token'), { server });
    expect(r.code, r.stderr).toBe(0);
    expect(r.json()).toEqual(DATA);
    const req = server.requests[0];
    expect(req.headers.authorization).toBe('Bearer sf-token');
    // The store's REST token must never go to the storefront host.
    expect(req.headers['x-auth-token']).toBeUndefined();
    expect(JSON.parse(req.body)).toEqual({ query: QUERY });
  });

  it('reads the token from BIGC_STOREFRONT_TOKEN', async () => {
    server.on({ method: 'POST', path: '/graphql', body: { data: DATA } });
    const r = await runCli(sf('--query', QUERY), { server, env: { BIGC_STOREFRONT_TOKEN: 'env-token' } });
    expect(r.code).toBe(0);
    expect(server.requests[0].headers.authorization).toBe('Bearer env-token');
  });

  it('without a token it is a usage error', async () => {
    const r = await runCli(sf('--query', QUERY), { server });
    expect(r.code).toBe(2);
    expect(r.errorJson().error.title).toContain('--mint');
  });

  it('GraphQL errors exit 5 with path and extensions', async () => {
    const errors = [{ message: 'Field "nope" does not exist', path: ['site', 'nope'], extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }];
    server.on({ method: 'POST', path: '/graphql', body: { errors } });
    const r = await runCli(sf('--query', '{ site { nope } }', '--token', 't'), { server });
    expect(r.code).toBe(5);
    expect(r.errorJson().error).toMatchObject({ type: 'graphql', errors });
  });

  it('--mint creates a short-lived private token, then uses it', async () => {
    server.on(
      { method: 'POST', path: '/v3/storefront/api-token-private', body: { data: { token: 'minted' }, meta: {} } },
      { method: 'POST', path: '/graphql', body: { data: DATA } },
    );
    const before = Math.floor(Date.now() / 1000);
    const r = await runCli(sf('--query', QUERY, '--mint'), { server });
    expect(r.code, r.stderr).toBe(0);
    const [mintReq, gqlReq] = server.requests;
    expect(mintReq.headers['x-auth-token']).toBe(TOKEN);
    const body = JSON.parse(mintReq.body);
    expect(body).toMatchObject({ channel_ids: [1], scopes: ['Unauthenticated'] });
    expect(body.expires_at).toBeGreaterThan(before);
    expect(body.expires_at).toBeLessThanOrEqual(before + 3700);
    expect(gqlReq.headers.authorization).toBe('Bearer minted');
    expect(r.stdout).not.toContain('minted');
  });

  it('--customer-id mints an impersonation token and sends X-Bc-Customer-Id', async () => {
    server.on(
      { method: 'POST', path: '/v3/storefront/api-token-customer-impersonation', body: { data: { token: 'cit' }, meta: {} } },
      { method: 'POST', path: '/graphql', body: { data: { customer: { entityId: 42 } } } },
    );
    const r = await runCli(sf('--query', '{ customer { entityId } }', '--mint', '--customer-id', '42', '--channel-id', '1'), { server });
    // --domain takes precedence over --channel-id for the endpoint, so no site lookup happens.
    expect(r.code, r.stderr).toBe(0);
    expect(server.requests).toHaveLength(2);
    expect(JSON.parse(server.requests[0].body)).toMatchObject({ channel_id: 1 });
    expect(server.requests[1].headers['x-bc-customer-id']).toBe('42');
    expect(server.requests[1].headers.authorization).toBe('Bearer cit');
  });

  it('--customer-id with a given token sends the header without minting', async () => {
    server.on({ method: 'POST', path: '/graphql', body: { data: {} } });
    const r = await runCli(sf('--query', '{ customer { entityId } }', '--token', 'my-cit', '--customer-id', '7'), { server });
    expect(r.code).toBe(0);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].headers['x-bc-customer-id']).toBe('7');
  });

  it('--customer-id must be numeric', async () => {
    const r = await runCli(sf('--query', QUERY, '--token', 't', '--customer-id', 'bob'), { server });
    expect(r.code).toBe(2);
  });

  it('--channel-id looks up the channel site URL', async () => {
    server.on(
      { method: 'GET', path: '/v3/channels/5/site', body: { data: { id: 1, url: `${server.url}/shop-five`, channel_id: 5 } } },
      { method: 'POST', path: '/shop-five/graphql', body: { data: DATA } },
    );
    const r = await runCli(['storefront', 'graphql', '--channel-id', '5', '--query', QUERY, '--token', 't'], { server });
    expect(r.code, r.stderr).toBe(0);
    expect(server.requests.map(q => q.path)).toEqual(['/v3/channels/5/site', '/shop-five/graphql']);
  });

  it('mutations are dry-runnable and blocked in read-only mode', async () => {
    const mutation = 'mutation { cart { createCart(input: { lineItems: [] }) { cart { entityId } } } }';
    const dry = await runCli(sf('--query', mutation, '--token', 't', '--dry-run'), { server });
    expect(dry.code).toBe(0);
    expect(dry.json()).toMatchObject({ dryRun: true, method: 'POST' });
    expect(server.requests).toHaveLength(0);

    const blocked = await runCli(sf('--query', mutation, '--token', 't'), { server, env: { BIGC_READ_ONLY: '1' } });
    expect(blocked.code).toBe(7);
    expect(server.requests).toHaveLength(0);
  });

  it('--mint still works in read-only mode, for queries', async () => {
    server.on(
      { method: 'POST', path: '/v3/storefront/api-token-private', body: { data: { token: 'minted' } } },
      { method: 'POST', path: '/graphql', body: { data: DATA } },
    );
    const r = await runCli(sf('--query', QUERY, '--mint'), { server, env: { BIGC_READ_ONLY: '1' } });
    expect(r.code, r.stderr).toBe(0);
  });

  it('storefront graphql schema --out saves the introspection result', async () => {
    const schema = { __schema: { queryType: { name: 'Query' }, types: [{ name: 'Query' }, { name: 'Site' }] } };
    server.on({ method: 'POST', path: '/graphql', body: { data: schema } });
    const out = path.join(tempDir(), 'sf-schema.json');
    const r = await runCli(['storefront', 'graphql', 'schema', '--out', out, '--domain', server.url, '--token', 't'], { server });
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(out, 'utf-8'))).toEqual(schema);
    expect(r.json()).toMatchObject({ ok: true, file: out, types: 2 });
    expect(JSON.parse(server.requests[0].body).query).toContain('__schema');
  });

  it('graphql schema --out saves the Admin schema', async () => {
    const schema = { __schema: { types: [{ name: 'Query' }] } };
    server.on({ method: 'POST', path: '/graphql', body: { data: schema } });
    const out = path.join(tempDir(), 'admin-schema.json');
    const r = await runCli(['graphql', 'schema', '--out', out], { server });
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(out, 'utf-8'))).toEqual(schema);
    expect(server.requests[0].headers['x-auth-token']).toBe(TOKEN);
  });
});
