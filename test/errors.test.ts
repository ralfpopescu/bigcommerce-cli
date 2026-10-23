import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MockServer, runCli, TOKEN } from './support/cli';

let server: MockServer;
beforeAll(async () => { server = await new MockServer().start(); });
afterAll(() => server.close());
beforeEach(() => server.reset());

const FIELD_422 = {
  status: 422,
  title: 'JSON data is missing or invalid',
  type: 'https://developer.bigcommerce.com/api-docs/getting-started/api-status-codes',
  errors: { price: 'price must be greater than or equal to 0', name: 'name is required' },
};

describe('structured API errors', () => {
  it('422 in json mode: one error object on stderr with the field errors, exit 5', async () => {
    server.on({ method: 'PUT', path: '/v3/catalog/products/12', status: 422, body: FIELD_422 });
    const r = await runCli(['catalog', 'products', 'update', '12', '--data', '{"price":-1}', '-o', 'json'], { server });
    expect(r.code).toBe(5);
    expect(r.stdout).toBe('');
    expect(r.errorJson()).toEqual({
      error: {
        status: 422,
        title: 'JSON data is missing or invalid',
        errors: FIELD_422.errors,
        method: 'PUT',
        path: '/v3/catalog/products/12',
      },
    });
    expect(r.stderr).not.toContain(TOKEN);
  });

  it('422 in pretty mode prints the title and each field error on its own line', async () => {
    server.on({ method: 'PUT', path: '/v3/catalog/products/12', status: 422, body: FIELD_422 });
    const r = await runCli(['catalog', 'products', 'update', '12', '--data', '{"price":-1}', '-o', 'pretty'], { server });
    expect(r.code).toBe(5);
    expect(r.stderr).toContain('422: JSON data is missing or invalid');
    expect(r.stderr).toContain('PUT /v3/catalog/products/12');
    expect(r.stderr).toMatch(/\n\s+- price: price must be greater than or equal to 0\n/);
    expect(r.stderr).toMatch(/\n\s+- name: name is required\n/);
  });

  it('V2 array errors keep their messages', async () => {
    server.on({ method: 'PUT', path: '/v2/orders/5', status: 400, body: [{ status: 400, message: 'The field status_id is invalid.' }] });
    const r = await runCli(['orders', 'update', '5', '--status', '99'], { server });
    expect(r.code).toBe(5);
    const e = r.errorJson().error;
    expect(e.title).toBe('The field status_id is invalid.');
    expect(e.errors).toEqual([{ status: 400, message: 'The field status_id is invalid.' }]);
  });

  it('401 exits 3', async () => {
    server.on({ method: 'GET', path: '/v3/catalog/products', status: 401, body: { status: 401, title: 'Unauthorized' } });
    const r = await runCli(['catalog', 'products', 'list'], { server });
    expect(r.code).toBe(3);
    expect(r.errorJson().error.status).toBe(401);
  });

  it('403 exits 3', async () => {
    server.on({ method: 'GET', path: '/v2/orders', status: 403, body: { status: 403, title: 'You do not have permission' } });
    const r = await runCli(['orders', 'list'], { server });
    expect(r.code).toBe(3);
  });

  it('404 exits 4', async () => {
    server.on({ method: 'GET', path: '/v3/catalog/products/999', status: 404, body: { status: 404, title: 'The requested resource was not found.' } });
    const r = await runCli(['catalog', 'products', 'get', '999'], { server });
    expect(r.code).toBe(4);
    expect(r.errorJson().error).toMatchObject({ status: 404, method: 'GET', path: '/v3/catalog/products/999' });
  });

  it('429 retries, then exits 6 with retryAfterMs once retries run out', async () => {
    server.on({
      method: 'GET', path: '/v3/catalog/brands', status: 429,
      headers: { 'X-Rate-Limit-Time-Reset-Ms': '5' },
      body: { status: 429, title: 'Too many requests' },
    });
    const r = await runCli(['catalog', 'brands', 'list'], { server });
    expect(r.code).toBe(6);
    expect(server.requests).toHaveLength(4);
    expect(r.errorJson().error).toMatchObject({ status: 429, retryAfterMs: 5 });
  });

  it('429 followed by success is invisible to the caller', async () => {
    server.on(
      { method: 'GET', path: '/v3/catalog/brands', status: 429, times: 1, headers: { 'X-Rate-Limit-Time-Reset-Ms': '5' } },
      { method: 'GET', path: '/v3/catalog/brands', body: { data: [{ id: 1, name: 'Acme' }] } },
    );
    const r = await runCli(['catalog', 'brands', 'list'], { server });
    expect(r.code).toBe(0);
    expect(r.json()).toEqual([{ id: 1, name: 'Acme' }]);
  });

  it('500 exits 8', async () => {
    server.on({ method: 'GET', path: '/v3/catalog/products', status: 500, body: { status: 500, title: 'Internal Server Error' } });
    const r = await runCli(['catalog', 'products', 'list'], { server });
    expect(r.code).toBe(8);
  });

  it('non-JSON error bodies still produce a structured error', async () => {
    server.on({ method: 'GET', path: '/v3/catalog/products', status: 502 });
    const r = await runCli(['catalog', 'products', 'list'], { server });
    expect(r.code).toBe(8);
    expect(r.errorJson().error.status).toBe(502);
  });

  it('bad JSON in --data exits 2 and names the flag, without calling the API', async () => {
    const r = await runCli(['catalog', 'products', 'create', '--data', '{"name":'], { server });
    expect(r.code).toBe(2);
    expect(r.errorJson().error.title).toMatch(/^--data is not valid JSON/);
    expect(server.requests).toHaveLength(0);
  });

  it('bad JSON in --file exits 2 and names the flag', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bigc-')), 'bad.json');
    fs.writeFileSync(file, 'not json');
    const r = await runCli(['api', 'POST', '/v3/catalog/products', '--file', file], { server });
    expect(r.code).toBe(2);
    expect(r.errorJson().error.title).toContain('--file');
  });

  it('missing required option exits 2', async () => {
    const r = await runCli(['catalog', 'products', 'custom-fields', 'list'], { server });
    expect(r.code).toBe(2);
    expect(r.errorJson().error.type).toBe('usage');
  });

  it('missing credentials exits 3', async () => {
    const r = await runCli(['catalog', 'products', 'list'], { server, noEnvCredentials: true });
    expect(r.code).toBe(3);
    expect(r.errorJson().error.title).toContain('bigc auth login');
  });

  it('the api escape hatch shares the same error handling', async () => {
    server.on({ method: 'POST', path: '/v3/catalog/categories', status: 422, body: { status: 422, title: 'Invalid', errors: { parent_id: 'required' } } });
    const r = await runCli(['api', 'POST', '/v3/catalog/categories', '--data', '{}'], { server });
    expect(r.code).toBe(5);
    expect(r.errorJson().error.errors).toEqual({ parent_id: 'required' });
  });

  it('GraphQL errors[] exit 5 and keep path and extensions', async () => {
    const errors = [{ message: 'Field "nope" not found', path: ['store', 'nope'], extensions: { code: 'FIELD_NOT_FOUND' } }];
    server.on({ method: 'POST', path: '/graphql', body: { data: null, errors } });
    const r = await runCli(['graphql', '--query', '{ store { nope } }'], { server });
    expect(r.code).toBe(5);
    expect(r.errorJson().error).toMatchObject({ type: 'graphql', errors });
  });

  it('an unparseable GraphQL document is a usage error', async () => {
    const r = await runCli(['graphql', '--query', '{ store { '], { server });
    expect(r.code).toBe(2);
    expect(server.requests).toHaveLength(0);
  });

  it('payments process errors go through the same handler', async () => {
    server.on({ method: 'POST', path: '/payments', status: 422, body: { title: 'Card declined', errors: { card: 'declined' } } });
    const r = await runCli(['payments', 'process', '--token', 'pat', '--data', '{}'], {
      server,
      env: { BIGC_PAYMENTS_URL: server.url },
    });
    expect(r.code).toBe(5);
    expect(r.errorJson().error).toMatchObject({ title: 'Card declined', errors: { card: 'declined' } });
    // The store token must never be sent to the payments host.
    expect(server.requests[0].headers['x-auth-token']).toBeUndefined();
    expect(server.requests[0].headers.authorization).toBe('PAT pat');
  });
});
