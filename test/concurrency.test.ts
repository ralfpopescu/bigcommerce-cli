import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MockServer, runCli } from './support/cli';

let server: MockServer;
beforeAll(async () => { server = await new MockServer().start(); });
afterAll(() => server.close());
beforeEach(() => server.reset());

const TOTAL = 6;

/** Page n answers after a delay that shrinks with n, so later pages finish first. */
function pages(headers: Record<string, string> = {}) {
  for (let n = 1; n <= TOTAL; n++) {
    server.on({
      method: 'GET',
      path: '/v3/catalog/products',
      times: 1,
      delayMs: (TOTAL - n) * 30,
      headers,
      body: {
        data: [{ id: n * 10 + 1 }, { id: n * 10 + 2 }],
        meta: { pagination: { current_page: n, total_pages: TOTAL, total: TOTAL * 2, count: 2, per_page: 250 } },
      },
    });
  }
}

describe('--all --concurrency', () => {
  it('fetches pages in parallel and keeps the output in page order', async () => {
    pages();
    const r = await runCli(['catalog', 'products', 'list', '--all', '--concurrency', '3'], { server });
    expect(r.code, r.stderr).toBe(0);
    const want = Array.from({ length: TOTAL }, (_, i) => [(i + 1) * 10 + 1, (i + 1) * 10 + 2]).flat();
    expect(r.json().map((p: { id: number }) => p.id)).toEqual(want);
    expect(server.maxConcurrent).toBeGreaterThan(1);
    expect(server.maxConcurrent).toBeLessThanOrEqual(3);
  });

  it('streams in order with --ndjson', async () => {
    pages();
    const r = await runCli(['catalog', 'products', 'list', '--all', '--ndjson', '--concurrency', '4'], { server });
    const ids = r.stdout.trim().split('\n').map(l => JSON.parse(l).id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(ids).toHaveLength(TOTAL * 2);
  });

  it('defaults to one request at a time', async () => {
    pages();
    const r = await runCli(['catalog', 'products', 'list', '--all'], { server });
    expect(r.code).toBe(0);
    expect(server.maxConcurrent).toBe(1);
  });

  it('backs off to sequential when the rate-limit window is nearly spent', async () => {
    pages({ 'X-Rate-Limit-Requests-Left': '2' });
    const r = await runCli(['catalog', 'products', 'list', '--all', '--concurrency', '4'], { server });
    expect(r.code).toBe(0);
    expect(server.maxConcurrent).toBe(1);
  });

  it('rejects a silly value', async () => {
    const r = await runCli(['catalog', 'products', 'list', '--all', '--concurrency', '50'], { server });
    expect(r.code).toBe(2);
  });
});
