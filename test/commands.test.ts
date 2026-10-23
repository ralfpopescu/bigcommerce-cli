import { beforeAll, describe, expect, it } from 'vitest';
import { runCli } from './support/cli';

let catalog: any[];
const find = (command: string) => catalog.find(e => e.command === command);

beforeAll(async () => {
  const r = await runCli(['commands', '--json']);
  expect(r.code).toBe(0);
  catalog = r.json();
});

describe('bigc commands --json', () => {
  it('covers the whole tree', () => {
    expect(catalog.length).toBeGreaterThan(600);
    for (const e of catalog) {
      expect(e).toHaveProperty('command');
      expect(typeof e.mutating === 'boolean' || e.mutating === 'conditional').toBe(true);
    }
  });

  it('describes a generated v3-item resource', () => {
    expect(find('catalog products custom-fields get')).toMatchObject({
      description: 'Get a custom field by ID',
      arguments: [{ name: 'id', required: true, variadic: false }],
      http: { method: 'GET', path: '/v3/catalog/products/{product_id}/custom-fields/{id}' },
      mutating: false,
      body: false,
    });
    expect(find('catalog products custom-fields get').options).toContainEqual(
      expect.objectContaining({ name: '--product-id', required: true, takesValue: true }));

    expect(find('catalog products custom-fields update')).toMatchObject({
      http: { method: 'PUT', path: '/v3/catalog/products/{product_id}/custom-fields/{id}' },
      mutating: true,
      body: true,
    });
  });

  it('describes an action', () => {
    expect(find('themes activate')).toMatchObject({
      http: { method: 'POST', path: '/v3/themes/actions/activate' },
      mutating: true,
      body: true,
    });
  });

  it('describes a hand-written multipart command', () => {
    expect(find('catalog products images add')).toMatchObject({
      http: { method: 'POST', path: '/v3/catalog/products/{product_id}/images' },
      mutating: true,
      multipart: true,
    });
  });

  it('describes the api escape hatch as conditionally mutating', () => {
    expect(find('api')).toMatchObject({
      arguments: [{ name: 'method', required: true }, { name: 'path', required: true }],
      mutating: 'conditional',
    });
  });

  it('marks GETs as non-mutating and everything else as mutating', () => {
    for (const e of catalog.filter(e => e.http)) {
      if (e.mutating === 'conditional') continue;
      expect(e.mutating, e.command).toBe(e.http.method !== 'GET');
    }
  });

  it('--filter narrows the list', async () => {
    const r = await runCli(['commands', '--json', '--filter', 'custom-fields']);
    const entries = r.json();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.length).toBeLessThan(20);
    for (const e of entries) expect(JSON.stringify([e.command, e.description, e.http?.path])).toContain('custom-fields');
  });

  it('help <command> --json returns the single entry', async () => {
    const r = await runCli(['help', 'catalog', 'products', 'images', 'add', '--json']);
    expect(r.code).toBe(0);
    expect(r.json()).toEqual(find('catalog products images add'));
  });

  it('help on an unknown command exits 2', async () => {
    const r = await runCli(['help', 'nope', '--json']);
    expect(r.code).toBe(2);
  });
});
