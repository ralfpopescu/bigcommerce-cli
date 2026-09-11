import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { client, printed, resetClient, run, succeeded } from './setup';

vi.mock('../../src/api/factory', () => ({ createClient: vi.fn(() => client) }));
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

import { registerCatalog } from '../../src/commands/catalog';

// The upload commands stat the path before sending, so this has to be real.
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bigc-catalog-'));
const imageFile = path.join(fixtureDir, 'pixel.png');

fs.writeFileSync(imageFile, Buffer.from('89504e470d0a1a0a', 'hex'));

afterAll(() => {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

function program(): Command {
  const p = new Command();

  p.exitOverride();
  registerCatalog(p);

  return p;
}

beforeEach(resetClient);

describe('catalog registration', () => {
  it('mounts the documented resources under catalog', () => {
    const catalog = program().commands.find((c) => c.name() === 'catalog')!;
    const names = catalog.commands.map((c) => c.name());

    expect(names).toEqual(expect.arrayContaining(['products', 'categories', 'brands', 'variants']));
  });

  it('mounts image management under products, categories, and brands', () => {
    const catalog = program().commands.find((c) => c.name() === 'catalog')!;
    const products = catalog.commands.find((c) => c.name() === 'products')!;
    const categories = catalog.commands.find((c) => c.name() === 'categories')!;
    const brands = catalog.commands.find((c) => c.name() === 'brands')!;

    expect(products.commands.map((c) => c.name())).toContain('images');
    expect(categories.commands.map((c) => c.name())).toContain('image');
    expect(brands.commands.map((c) => c.name())).toContain('image');
  });
});

describe('catalog products', () => {
  it('lists products', async () => {
    client.get.mockResolvedValue({ data: [{ id: 1, name: 'Widget' }] });

    await run(program(), ['catalog', 'products', 'list']);

    expect(client.get).toHaveBeenCalledWith('v3', 'catalog/products', expect.any(Object));
    expect(printed[0]).toEqual([{ id: 1, name: 'Widget' }]);
  });

  it('auto-paginates with --all', async () => {
    client.getAllV3.mockResolvedValue([{ id: 1 }]);

    await run(program(), ['catalog', 'products', 'list', '--all']);

    expect(client.getAllV3).toHaveBeenCalled();
  });

  it('passes a named filter through', async () => {
    await run(program(), ['catalog', 'products', 'list', '--sku', 'A-1']);

    expect(client.get).toHaveBeenCalledWith(
      'v3',
      'catalog/products',
      expect.objectContaining({ sku: 'A-1' }),
    );
  });

  it('gets a product by id', async () => {
    client.get.mockResolvedValue({ data: { id: 7, name: 'Widget' } });

    await run(program(), ['catalog', 'products', 'get', '7']);

    expect(client.get).toHaveBeenCalledWith('v3', 'catalog/products/7');
    expect(printed[0]).toMatchObject({ id: 7 });
  });

  it('creates a product from inline JSON', async () => {
    client.post.mockResolvedValue({ data: { id: 9 } });
    client.request.mockResolvedValue({ data: { id: 9 } });

    await run(program(), ['catalog', 'products', 'create', '--data', '{"name":"Widget"}']);

    expect(succeeded.join(' ')).toMatch(/created/i);
  });

  it('refuses to create without a body', async () => {
    await expect(run(program(), ['catalog', 'products', 'create'])).rejects.toThrow(
      /--data <json> or --file/,
    );
  });

  it('updates a product', async () => {
    client.put.mockResolvedValue({ data: { id: 7 } });
    client.request.mockResolvedValue({ data: { id: 7 } });

    await run(program(), ['catalog', 'products', 'update', '7', '--data', '{"name":"New"}']);

    expect(succeeded.join(' ')).toMatch(/updated/i);
  });

  it('deletes a product', async () => {
    await run(program(), ['catalog', 'products', 'delete', '7']);

    expect(succeeded.join(' ')).toMatch(/deleted/i);
  });

  it('surfaces an API error', async () => {
    client.get.mockRejectedValue(new Error('401: Unauthorized'));

    await expect(run(program(), ['catalog', 'products', 'list'])).rejects.toThrow(
      '401: Unauthorized',
    );
  });
});

describe('catalog product images', () => {
  it('uploads a local file as multipart', async () => {
    await run(program(), [
      'catalog',
      'products',
      'images',
      'add',
      '--product-id',
      '329',
      '--file',
      imageFile,
    ]);

    const multipart = client.postMultipart.mock.calls.length
      ? client.postMultipart.mock.calls
      : client.requestMultipart.mock.calls;

    expect(multipart.length).toBeGreaterThan(0);
    expect(JSON.stringify(multipart[0])).toContain('pixel.png');
  });

  it('sends a remote URL as JSON rather than multipart', async () => {
    await run(program(), [
      'catalog',
      'products',
      'images',
      'add',
      '--product-id',
      '329',
      '--url',
      'https://x.test/a.png',
    ]);

    expect(client.postMultipart).not.toHaveBeenCalled();
    expect(
      JSON.stringify(client.post.mock.calls) + JSON.stringify(client.request.mock.calls),
    ).toContain('https://x.test/a.png');
  });

  it('demands one of --file or --url', async () => {
    await expect(
      run(program(), ['catalog', 'products', 'images', 'add', '--product-id', '329']),
    ).rejects.toThrow(/--file|--url/);
  });

  it('lists product images', async () => {
    client.get.mockResolvedValue({ data: [{ id: 1, product_id: 329 }] });

    await run(program(), ['catalog', 'products', 'images', 'list', '--product-id', '329']);

    expect(client.get).toHaveBeenCalledWith('v3', 'catalog/products/329/images');
  });
});

describe('catalog categories and brands', () => {
  it('lists categories', async () => {
    client.get.mockResolvedValue({ data: [{ id: 1, name: 'Hats' }] });

    await run(program(), ['catalog', 'categories', 'list']);

    expect(printed[0]).toEqual([{ id: 1, name: 'Hats' }]);
  });

  it('gets a category by id', async () => {
    client.get.mockResolvedValue({ data: [{ id: 3, name: 'Hats' }] });

    await run(program(), ['catalog', 'categories', 'get', '3']);

    expect(client.get).toHaveBeenCalled();
  });

  it('lists brands', async () => {
    client.get.mockResolvedValue({ data: [{ id: 1, name: 'Acme' }] });

    await run(program(), ['catalog', 'brands', 'list']);

    expect(printed[0]).toEqual([{ id: 1, name: 'Acme' }]);
  });

  it('sets a brand image from a file', async () => {
    await run(program(), [
      'catalog',
      'brands',
      'image',
      'set',
      '--brand-id',
      '1',
      '--file',
      imageFile,
    ]);

    const calls =
      JSON.stringify(client.postMultipart.mock.calls) +
      JSON.stringify(client.putMultipart.mock.calls) +
      JSON.stringify(client.requestMultipart.mock.calls);

    expect(calls).toContain('pixel.png');
  });
});

describe('catalog variants', () => {
  it('lists variants for a product', async () => {
    client.get.mockResolvedValue({ data: [{ id: 1, sku: 'A-1' }] });

    await run(program(), ['catalog', 'variants', 'list', '--product-id', '329']);

    expect(client.get).toHaveBeenCalledWith(
      'v3',
      'catalog/products/329/variants',
      expect.any(Object),
    );
  });
});

describe('catalog products with inline images', () => {
  it('creates a product and attaches a local image in one call', async () => {
    client.request.mockResolvedValue({ data: { id: 9 } });
    client.post.mockResolvedValue({ data: { id: 9 } });

    await run(program(), [
      'catalog',
      'products',
      'create',
      '--data',
      '{"name":"Widget"}',
      '--image-file',
      imageFile,
    ]);

    const uploads =
      JSON.stringify(client.postMultipart.mock.calls) +
      JSON.stringify(client.requestMultipart.mock.calls);

    expect(uploads).toContain('pixel.png');
  });

  it('attaches multiple images', async () => {
    client.request.mockResolvedValue({ data: { id: 9 } });
    client.post.mockResolvedValue({ data: { id: 9 } });

    await run(program(), [
      'catalog',
      'products',
      'create',
      '--data',
      '{"name":"Widget"}',
      '--image-file',
      imageFile,
      '--image-file',
      imageFile,
    ]);

    const count =
      client.postMultipart.mock.calls.length + client.requestMultipart.mock.calls.length;

    expect(count).toBe(2);
  });

  it('attaches a remote image URL on update', async () => {
    client.request.mockResolvedValue({ data: { id: 7 } });
    client.put.mockResolvedValue({ data: { id: 7 } });

    await run(program(), [
      'catalog',
      'products',
      'update',
      '7',
      '--data',
      '{"name":"New"}',
      '--image-url',
      'https://x.test/a.png',
    ]);

    const sent = JSON.stringify(client.post.mock.calls) + JSON.stringify(client.request.mock.calls);

    expect(sent).toContain('https://x.test/a.png');
  });

  it('still creates the product when an image file is missing, and warns', async () => {
    // A failed image upload is reported but does not roll back the product.
    const warnings: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((msg: unknown) => {
      warnings.push(String(msg));
    });

    client.request.mockResolvedValue({ data: { id: 9 } });
    client.post.mockResolvedValue({ data: { id: 9 } });

    await run(program(), [
      'catalog',
      'products',
      'create',
      '--data',
      '{"name":"Widget"}',
      '--image-file',
      '/no/such/file.png',
    ]);

    expect(succeeded.join(' ')).toMatch(/created/i);
    expect(warnings.join(' ')).toMatch(/image upload failed.*file not found/i);

    spy.mockRestore();
  });
});

describe('catalog product image mutations', () => {
  it('updates an image with new metadata', async () => {
    await run(program(), [
      'catalog',
      'products',
      'images',
      'update',
      '55',
      '--product-id',
      '329',
      '--description',
      'Front view',
    ]);

    const sent =
      JSON.stringify(client.put.mock.calls) +
      JSON.stringify(client.request.mock.calls) +
      JSON.stringify(client.putMultipart.mock.calls);

    expect(sent).toContain('Front view');
  });

  it('replaces an image file', async () => {
    await run(program(), [
      'catalog',
      'products',
      'images',
      'update',
      '55',
      '--product-id',
      '329',
      '--file',
      imageFile,
    ]);

    const sent =
      JSON.stringify(client.putMultipart.mock.calls) +
      JSON.stringify(client.requestMultipart.mock.calls);

    expect(sent).toContain('pixel.png');
  });

  it('deletes an image', async () => {
    await run(program(), ['catalog', 'products', 'images', 'delete', '55', '--product-id', '329']);

    expect(client.del).toHaveBeenCalledWith('v3', 'catalog/products/329/images/55');
    expect(succeeded.join(' ')).toMatch(/deleted/i);
  });
});

describe('catalog category mutations', () => {
  it('creates a category', async () => {
    client.request.mockResolvedValue({ data: [{ id: 5 }] });
    client.post.mockResolvedValue({ data: [{ id: 5 }] });

    await run(program(), ['catalog', 'categories', 'create', '--data', '{"name":"Hats"}']);

    expect(succeeded.length).toBeGreaterThan(0);
  });

  it('updates a category', async () => {
    client.request.mockResolvedValue({ data: [{ id: 5 }] });
    client.put.mockResolvedValue({ data: [{ id: 5 }] });

    await run(program(), ['catalog', 'categories', 'update', '5', '--data', '{"name":"Caps"}']);

    expect(succeeded.length).toBeGreaterThan(0);
  });

  it('deletes a category', async () => {
    await run(program(), ['catalog', 'categories', 'delete', '5']);

    expect(succeeded.join(' ')).toMatch(/deleted/i);
  });

  it('sets a category image from a file', async () => {
    await run(program(), [
      'catalog',
      'categories',
      'image',
      'set',
      '--category-id',
      '5',
      '--file',
      imageFile,
    ]);

    const sent =
      JSON.stringify(client.postMultipart.mock.calls) +
      JSON.stringify(client.putMultipart.mock.calls) +
      JSON.stringify(client.requestMultipart.mock.calls);

    expect(sent).toContain('pixel.png');
  });

  it('deletes a category image', async () => {
    await run(program(), ['catalog', 'categories', 'image', 'delete', '--category-id', '5']);

    expect(client.del).toHaveBeenCalled();
  });

  it('deletes a brand image', async () => {
    await run(program(), ['catalog', 'brands', 'image', 'delete', '--brand-id', '1']);

    expect(client.del).toHaveBeenCalled();
  });
});

describe('catalog variant mutations', () => {
  it('gets a variant', async () => {
    client.get.mockResolvedValue({ data: { id: 11, sku: 'A-1' } });

    await run(program(), ['catalog', 'variants', 'get', '11', '--product-id', '329']);

    expect(client.get).toHaveBeenCalledWith('v3', 'catalog/products/329/variants/11');
  });

  it('creates a variant', async () => {
    client.request.mockResolvedValue({ data: { id: 11 } });
    client.post.mockResolvedValue({ data: { id: 11 } });

    await run(program(), [
      'catalog',
      'variants',
      'create',
      '--product-id',
      '329',
      '--data',
      '{"sku":"A-2"}',
    ]);

    expect(succeeded.length).toBeGreaterThan(0);
  });

  it('updates a variant', async () => {
    client.request.mockResolvedValue({ data: { id: 11 } });
    client.put.mockResolvedValue({ data: { id: 11 } });

    await run(program(), [
      'catalog',
      'variants',
      'update',
      '11',
      '--product-id',
      '329',
      '--data',
      '{"price":5}',
    ]);

    expect(succeeded.length).toBeGreaterThan(0);
  });

  it('deletes a variant', async () => {
    await run(program(), ['catalog', 'variants', 'delete', '11', '--product-id', '329']);

    expect(succeeded.join(' ')).toMatch(/deleted/i);
  });

  it('auto-paginates variants', async () => {
    client.getAllV3.mockResolvedValue([{ id: 11 }]);

    await run(program(), ['catalog', 'variants', 'list', '--product-id', '329', '--all']);

    expect(client.getAllV3).toHaveBeenCalled();
  });
});
