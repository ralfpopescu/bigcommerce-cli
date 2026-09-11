import { describe, expect, it } from 'vitest';

import { ApiClient, ApiClientOptions } from '../../src/api/client';
import { fakeFetch, fakeResponse, fakeSleep } from '../helpers';

const BASE = 'https://api.example.test/stores';

function makeClient(overrides: Partial<ApiClientOptions> = {}) {
  const http = fakeFetch(overrides.fetch ? undefined : fakeResponse({ body: { data: [] } }));
  const client = new ApiClient({
    storeHash: 'abc123',
    accessToken: 'token-xyz',
    baseUrl: BASE,
    fetch: http.fetch,
    sleep: () => Promise.resolve(),
    ...overrides,
  });

  return { client, calls: http.calls };
}

describe('ApiClient URL construction', () => {
  it('builds a versioned store URL', async () => {
    const { client, calls } = makeClient();

    await client.get('v3', 'catalog/products');

    expect(calls[0]?.url).toBe(`${BASE}/abc123/v3/catalog/products`);
  });

  it('tolerates a leading slash on the resource', async () => {
    const { client, calls } = makeClient();

    await client.get('v2', '/orders');

    expect(calls[0]?.url).toBe(`${BASE}/abc123/v2/orders`);
  });

  it('appends query parameters and skips null and undefined', async () => {
    const { client, calls } = makeClient();

    await client.get('v3', 'catalog/products', {
      limit: 50,
      sku: 'A-1',
      missing: undefined,
      empty: null,
    });

    expect(calls[0]?.url).toBe(`${BASE}/abc123/v3/catalog/products?limit=50&sku=A-1`);
  });

  it('url-encodes parameter values', async () => {
    const { client, calls } = makeClient();

    await client.get('v3', 'catalog/products', { 'id:in': '1,2,3', name: 'a b&c' });

    expect(calls[0]?.url).toContain('id%3Ain=1%2C2%2C3');
    expect(calls[0]?.url).toContain('name=a+b%26c');
  });

  it('omits the question mark when every parameter was filtered out', async () => {
    const { client, calls } = makeClient();

    await client.get('v3', 'catalog/products', { a: undefined });

    expect(calls[0]?.url).toBe(`${BASE}/abc123/v3/catalog/products`);
  });

  it('routes request() against a raw store path', async () => {
    const { client, calls } = makeClient();

    await client.request('GET', '/v3/sites');

    expect(calls[0]?.url).toBe(`${BASE}/abc123/v3/sites`);
  });

  it('merges request() params into a path that already has a query', async () => {
    const { client, calls } = makeClient();

    await client.request('GET', 'v3/sites?a=1', { params: { b: '2' } });

    expect(calls[0]?.url).toBe(`${BASE}/abc123/v3/sites?a=1&b=2`);
  });

  it('posts GraphQL to the unversioned /graphql path', async () => {
    const { client, calls } = makeClient();

    await client.graphql('{ store { id } }', { x: 1 });

    expect(calls[0]?.url).toBe(`${BASE}/abc123/graphql`);
    expect(calls[0]?.method).toBe('POST');
    expect(JSON.parse(calls[0]?.body as string)).toEqual({
      query: '{ store { id } }',
      variables: { x: 1 },
    });
  });
});

describe('ApiClient requests', () => {
  it('sends the auth token and JSON content type', async () => {
    const { client, calls } = makeClient();

    await client.get('v3', 'catalog/products');

    expect(calls[0]?.headers).toMatchObject({
      'X-Auth-Token': 'token-xyz',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
  });

  it('serializes the body on POST and PUT', async () => {
    const { client, calls } = makeClient();

    await client.post('v3', 'catalog/products', { name: 'Widget' });
    await client.put('v3', 'catalog/products/1', { name: 'Gadget' });

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toBe('{"name":"Widget"}');
    expect(calls[1]?.method).toBe('PUT');
    expect(calls[1]?.body).toBe('{"name":"Gadget"}');
  });

  it('sends no body when none was given', async () => {
    const { client, calls } = makeClient();

    await client.del('v3', 'catalog/products/1');

    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.body).toBeUndefined();
  });
});

describe('ApiClient response handling', () => {
  it('returns null for 204 without reading a body', async () => {
    const http = fakeFetch(fakeResponse({ status: 204 }));
    const { client } = makeClient({ fetch: http.fetch });

    await expect(client.del('v3', 'catalog/products/1')).resolves.toBeNull();
  });

  it('parses a JSON body', async () => {
    const http = fakeFetch(fakeResponse({ body: { data: { id: 7 } } }));
    const { client } = makeClient({ fetch: http.fetch });

    await expect(client.get('v3', 'catalog/products/7')).resolves.toEqual({ data: { id: 7 } });
  });

  it('returns raw text when a successful body is not JSON', async () => {
    const http = fakeFetch(fakeResponse({ text: 'User-agent: *' }));
    const { client } = makeClient({ fetch: http.fetch });

    await expect(client.get('v3', 'settings/storefront/robotstxt')).resolves.toBe('User-agent: *');
  });

  it('returns null for an empty successful body', async () => {
    const http = fakeFetch(fakeResponse({ text: '' }));
    const { client } = makeClient({ fetch: http.fetch });

    await expect(client.get('v3', 'anything')).resolves.toBeNull();
  });

  it('prefers the "title" field for an error message', async () => {
    const http = fakeFetch(fakeResponse({ status: 422, body: { title: 'Invalid SKU' } }));
    const { client } = makeClient({ fetch: http.fetch });

    await expect(client.get('v3', 'catalog/products')).rejects.toThrow('422: Invalid SKU');
  });

  it('falls back to serializing "errors" when there is no title', async () => {
    const http = fakeFetch(fakeResponse({ status: 400, body: { errors: { sku: 'taken' } } }));
    const { client } = makeClient({ fetch: http.fetch });

    await expect(client.get('v3', 'catalog/products')).rejects.toThrow('400: {"sku":"taken"}');
  });

  it('serializes an errors array', async () => {
    const http = fakeFetch(fakeResponse({ status: 400, body: { errors: ['bad', 'worse'] } }));
    const { client } = makeClient({ fetch: http.fetch });

    await expect(client.get('v3', 'catalog/products')).rejects.toThrow('400: ["bad","worse"]');
  });

  it('falls back to the status text when the error body has neither', async () => {
    const http = fakeFetch(fakeResponse({ status: 500, body: { something: 'else' } }));
    const { client } = makeClient({ fetch: http.fetch });

    await expect(client.get('v3', 'catalog/products')).rejects.toThrow(
      '500: Internal Server Error',
    );
  });

  it('falls back to the status text when the error body is not JSON', async () => {
    const http = fakeFetch(fakeResponse({ status: 404, text: '<html>nope</html>' }));
    const { client } = makeClient({ fetch: http.fetch });

    await expect(client.get('v3', 'catalog/products')).rejects.toThrow('404: Not Found');
  });
});

describe('ApiClient rate limiting', () => {
  it('retries a 429 using the reset header and then succeeds', async () => {
    const http = fakeFetch([
      fakeResponse({ status: 429, headers: { 'X-Rate-Limit-Time-Reset-Ms': '1200' } }),
      fakeResponse({ body: { data: [] } }),
    ]);
    const clock = fakeSleep();
    const { client } = makeClient({ fetch: http.fetch, sleep: clock.sleep });

    await expect(client.get('v3', 'catalog/products')).resolves.toEqual({ data: [] });
    expect(clock.waits).toEqual([1200]);
    expect(http.calls).toHaveLength(2);
  });

  it('defaults to 5000ms when the reset header is absent', async () => {
    const http = fakeFetch([fakeResponse({ status: 429 }), fakeResponse({ body: { ok: true } })]);
    const clock = fakeSleep();
    const { client } = makeClient({ fetch: http.fetch, sleep: clock.sleep });

    await client.get('v3', 'catalog/products');

    expect(clock.waits).toEqual([5000]);
  });

  it('defaults to 5000ms when the reset header is not a number', async () => {
    const http = fakeFetch([
      fakeResponse({ status: 429, headers: { 'X-Rate-Limit-Time-Reset-Ms': 'soon' } }),
      fakeResponse({ body: { ok: true } }),
    ]);
    const clock = fakeSleep();
    const { client } = makeClient({ fetch: http.fetch, sleep: clock.sleep });

    await client.get('v3', 'catalog/products');

    expect(clock.waits).toEqual([5000]);
  });

  it('gives up after maxRetries and surfaces the 429', async () => {
    const http = fakeFetch(fakeResponse({ status: 429, body: { title: 'Rate limited' } }));
    const clock = fakeSleep();
    const { client } = makeClient({ fetch: http.fetch, sleep: clock.sleep, maxRetries: 2 });

    await expect(client.get('v3', 'catalog/products')).rejects.toThrow('429: Rate limited');
    // The initial attempt, plus two retries.
    expect(http.calls).toHaveLength(3);
    expect(clock.waits).toHaveLength(2);
  });
});

describe('ApiClient pagination', () => {
  it('follows V3 pagination to the last page', async () => {
    const http = fakeFetch([
      fakeResponse({
        body: { data: [{ id: 1 }], meta: { pagination: { current_page: 1, total_pages: 3 } } },
      }),
      fakeResponse({
        body: { data: [{ id: 2 }], meta: { pagination: { current_page: 2, total_pages: 3 } } },
      }),
      fakeResponse({
        body: { data: [{ id: 3 }], meta: { pagination: { current_page: 3, total_pages: 3 } } },
      }),
    ]);
    const { client } = makeClient({ fetch: http.fetch });

    await expect(client.getAllV3('catalog/products')).resolves.toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ]);
    expect(http.calls).toHaveLength(3);
    expect(http.calls[0]?.url).toContain('page=1');
    expect(http.calls[2]?.url).toContain('page=3');
  });

  it('requests the maximum page size and preserves caller filters', async () => {
    const http = fakeFetch(
      fakeResponse({
        body: { data: [], meta: { pagination: { current_page: 1, total_pages: 1 } } },
      }),
    );
    const { client } = makeClient({ fetch: http.fetch });

    await client.getAllV3('catalog/products', { sku: 'A-1' });

    expect(http.calls[0]?.url).toContain('limit=250');
    expect(http.calls[0]?.url).toContain('sku=A-1');
  });

  it('stops V3 pagination when the response carries no pagination meta', async () => {
    const http = fakeFetch(fakeResponse({ body: { data: [{ id: 1 }] } }));
    const { client } = makeClient({ fetch: http.fetch });

    await expect(client.getAllV3('catalog/products')).resolves.toEqual([{ id: 1 }]);
    expect(http.calls).toHaveLength(1);
  });

  it('stops V2 pagination on a short page', async () => {
    const http = fakeFetch(fakeResponse({ body: [{ id: 1 }, { id: 2 }] }));
    const { client } = makeClient({ fetch: http.fetch });

    await expect(client.getAllV2('orders')).resolves.toEqual([{ id: 1 }, { id: 2 }]);
    expect(http.calls).toHaveLength(1);
  });

  it('stops V2 pagination on an empty page', async () => {
    const http = fakeFetch(fakeResponse({ body: [] }));
    const { client } = makeClient({ fetch: http.fetch });

    await expect(client.getAllV2('orders')).resolves.toEqual([]);
  });

  it('stops V2 pagination when the endpoint answers 204', async () => {
    const http = fakeFetch(fakeResponse({ status: 204 }));
    const { client } = makeClient({ fetch: http.fetch });

    await expect(client.getAllV2('orders')).resolves.toEqual([]);
  });

  it('follows V2 pagination while pages come back full', async () => {
    const full = Array.from({ length: 250 }, (_, i) => ({ id: i }));
    const http = fakeFetch([fakeResponse({ body: full }), fakeResponse({ body: [{ id: 250 }] })]);
    const { client } = makeClient({ fetch: http.fetch });

    const all = await client.getAllV2('orders');

    expect(all).toHaveLength(251);
    expect(http.calls).toHaveLength(2);
  });
});

describe('ApiClient defaults', () => {
  it('targets the real BigCommerce host when no base URL is given', async () => {
    const http = fakeFetch(fakeResponse({ body: {} }));
    const client = new ApiClient({
      storeHash: 'abc123',
      accessToken: 't',
      fetch: http.fetch,
    });

    await client.get('v3', 'catalog/products');

    expect(http.calls[0]?.url).toBe(
      'https://api.bigcommerce.com/stores/abc123/v3/catalog/products',
    );
  });
});
