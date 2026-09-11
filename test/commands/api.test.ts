import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerApi } from '../../src/commands/api';

import { client, printed, resetClient, run, succeeded } from './setup';

vi.mock('../../src/api/factory', () => ({ createClient: vi.fn(() => client) }));
vi.mock('../../src/config', () => ({
  getProfile: vi.fn(() => ({ storeHash: 'abc123', accessToken: 'tok' })),
}));
vi.mock('ora', async () => {
  const { fakeOra } = await import('./setup');

  return { default: () => fakeOra() };
});
vi.mock('../../src/output', async () => {
  const actual = await vi.importActual<typeof import('../../src/output')>('../../src/output');

  return {
    ...actual,
    print: (data: unknown) => {
      printed.push(data);
    },
    success: (msg: string) => {
      succeeded.push(msg);
    },
    info: vi.fn(),
  };
});

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bigc-api-'));

afterAll(() => {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

function program(): Command {
  const p = new Command();

  p.exitOverride();
  registerApi(p);

  return p;
}

beforeEach(resetClient);

describe('bigc api', () => {
  it('passes the method and path straight through', async () => {
    client.request.mockResolvedValue({ data: [{ id: 1 }] });

    await run(program(), ['api', 'GET', '/v3/sites']);

    expect(client.request).toHaveBeenCalledWith('GET', '/v3/sites', {
      body: undefined,
      params: {},
    });
  });

  it('upper-cases a lowercase method', async () => {
    await run(program(), ['api', 'get', '/v3/sites']);

    expect(client.request).toHaveBeenCalledWith('GET', '/v3/sites', expect.any(Object));
  });

  it('unwraps the data envelope by default', async () => {
    client.request.mockResolvedValue({ data: [{ id: 1 }] });

    await run(program(), ['api', 'GET', '/v3/sites']);

    expect(printed[0]).toEqual([{ id: 1 }]);
  });

  it('keeps the envelope with --raw', async () => {
    client.request.mockResolvedValue({ data: [{ id: 1 }], meta: {} });

    await run(program(), ['api', 'GET', '/v3/sites', '--raw']);

    expect(printed[0]).toEqual({ data: [{ id: 1 }], meta: {} });
  });

  it('sends an inline JSON body', async () => {
    await run(program(), ['api', 'PUT', '/v3/channels/1', '--data', '{"status":"active"}']);

    expect(client.request).toHaveBeenCalledWith('PUT', '/v3/channels/1', {
      body: { status: 'active' },
      params: {},
    });
  });

  it('reads a body from a file', async () => {
    const file = path.join(fixtureDir, 'body.json');

    fs.writeFileSync(file, '{"name":"From file"}');

    await run(program(), ['api', 'POST', '/v3/catalog/brands', '--file', file]);

    expect(client.request).toHaveBeenCalledWith('POST', '/v3/catalog/brands', {
      body: { name: 'From file' },
      params: {},
    });
  });

  it('collects repeated query parameters', async () => {
    await run(program(), ['api', 'GET', '/v3/sites', '--query', 'a=1', '--query', 'b=2']);

    expect(client.request).toHaveBeenCalledWith('GET', '/v3/sites', {
      body: undefined,
      params: { a: '1', b: '2' },
    });
  });

  it('rejects a malformed query pair', async () => {
    await expect(run(program(), ['api', 'GET', '/v3/sites', '--query', 'oops'])).rejects.toThrow(
      /key=value/,
    );
  });

  it('reports a 204 rather than printing nothing', async () => {
    client.request.mockResolvedValue(null);

    await run(program(), ['api', 'DELETE', '/v3/catalog/products/1']);

    expect(succeeded.join(' ')).toContain('204 No Content');
    expect(printed).toHaveLength(0);
  });

  it('surfaces an API error', async () => {
    client.request.mockRejectedValue(new Error('403: Forbidden'));

    await expect(run(program(), ['api', 'GET', '/v3/sites'])).rejects.toThrow('403: Forbidden');
  });
});

describe('bigc graphql', () => {
  it('sends an inline query', async () => {
    client.graphql.mockResolvedValue({ data: { store: { id: 1 } } });

    await run(program(), ['graphql', '--query', '{ store { id } }']);

    expect(client.graphql).toHaveBeenCalledWith('{ store { id } }', undefined);
    expect(printed[0]).toEqual({ store: { id: 1 } });
  });

  it('reads a query from a file', async () => {
    const file = path.join(fixtureDir, 'q.graphql');

    fs.writeFileSync(file, '{ store { account { id } } }');
    client.graphql.mockResolvedValue({ data: {} });

    await run(program(), ['graphql', '--file', file]);

    expect(client.graphql).toHaveBeenCalledWith('{ store { account { id } } }', undefined);
  });

  it('parses variables', async () => {
    client.graphql.mockResolvedValue({ data: {} });

    await run(program(), ['graphql', '--query', 'query($id:Int){x}', '--variables', '{"id":1}']);

    expect(client.graphql).toHaveBeenCalledWith('query($id:Int){x}', { id: 1 });
  });

  it('demands a query', async () => {
    await expect(run(program(), ['graphql'])).rejects.toThrow(/--query <graphql> or --file/);
  });

  it('reports GraphQL errors instead of printing a null result', async () => {
    client.graphql.mockResolvedValue({ errors: [{ message: 'Bad field' }] });

    await expect(run(program(), ['graphql', '--query', '{x}'])).rejects.toThrow('Bad field');
    expect(printed).toHaveLength(0);
  });

  it('joins multiple GraphQL errors', async () => {
    client.graphql.mockResolvedValue({
      errors: [{ message: 'One' }, { message: 'Two' }],
    });

    await expect(run(program(), ['graphql', '--query', '{x}'])).rejects.toThrow('One; Two');
  });
});
