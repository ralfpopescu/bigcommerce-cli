import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = {
  get: vi.fn(),
  del: vi.fn(),
  request: vi.fn(),
  requestMultipart: vi.fn(),
  download: vi.fn(),
  getAllV3: vi.fn(),
  getAllV2: vi.fn(),
};

vi.mock('../src/api/factory', () => ({
  createClient: vi.fn(() => client),
}));

// Silence the spinner and the formatters; assertions are on the client calls.
vi.mock('ora', () => ({
  default: () => ({ start: () => ({ stop: vi.fn() }) }),
}));

const printed: unknown[] = [];

vi.mock('../src/output', async () => {
  const actual = await vi.importActual<typeof import('../src/output')>('../src/output');

  return {
    ...actual,
    print: (data: unknown) => {
      printed.push(data);
    },
    success: vi.fn(),
    info: vi.fn(),
  };
});

import { createClient } from '../src/api/factory';
import { CliError } from '../src/output';
import { mount, mountAll, queryOption, queryParams, type ResourceSpec } from '../src/resource';
import { RESOURCES } from '../src/resources';

function names(cmd: Command): string[] {
  return cmd.commands.map((c) => c.name()).sort();
}

function run(program: Command, argv: string[]): Promise<unknown> {
  return program.parseAsync(['node', 'bigc', ...argv]);
}

beforeEach(() => {
  vi.clearAllMocks();
  printed.length = 0;
  client.get.mockResolvedValue({ data: [] });
  client.del.mockResolvedValue(null);
  client.request.mockResolvedValue({ data: {} });
  client.requestMultipart.mockResolvedValue({ data: {} });
  client.download.mockResolvedValue(undefined);
  client.getAllV3.mockResolvedValue([]);
  client.getAllV2.mockResolvedValue([]);
});

describe('mount: which operations appear', () => {
  it('gives an item resource the five CRUD verbs', () => {
    const program = new Command();

    mount(program, {
      name: 'products',
      describe: 'Products',
      path: 'catalog/products',
      style: 'v3-item',
    });

    expect(names(program.commands[0]!)).toEqual(['create', 'delete', 'get', 'list', 'update']);
  });

  it('gives a singleton only get and update', () => {
    const program = new Command();

    mount(program, {
      name: 'robotstxt',
      describe: 'Robots.txt',
      path: 'settings/storefront/robotstxt',
      style: 'v3-singleton',
    });

    expect(names(program.commands[0]!)).toEqual(['get', 'update']);
  });

  it('honours an explicit ops list', () => {
    const program = new Command();

    mount(program, {
      name: 'summary',
      describe: 'Summary',
      path: 'catalog/summary',
      style: 'v3-singleton',
      ops: ['get'],
    });

    expect(names(program.commands[0]!)).toEqual(['get']);
  });

  it('mounts nothing without a path and style', () => {
    const program = new Command();

    mount(program, { name: 'group', describe: 'A grouping node' });

    expect(names(program.commands[0]!)).toEqual([]);
  });

  it('mounts children recursively', () => {
    const program = new Command();

    mount(program, {
      name: 'products',
      describe: 'Products',
      path: 'catalog/products',
      style: 'v3-item',
      children: [
        {
          name: 'images',
          describe: 'Images',
          path: 'catalog/products/{product_id}/images',
          style: 'v3-item',
        },
      ],
    });

    const images = program.commands[0]!.commands.find((c) => c.name() === 'images');

    expect(images).toBeDefined();
    expect(names(images!)).toContain('list');
  });

  it('mounts named actions', () => {
    const program = new Command();

    mount(program, {
      name: 'themes',
      describe: 'Themes',
      actions: [
        {
          name: 'activate',
          describe: 'Activate a theme',
          method: 'POST',
          path: 'v3/themes/actions/activate',
          body: true,
        },
      ],
    });

    expect(names(program.commands[0]!)).toEqual(['activate']);
  });
});

describe('mount: hand-written commands win', () => {
  const spec: ResourceSpec = {
    name: 'products',
    describe: 'Products',
    path: 'catalog/products',
    style: 'v3-item',
  };

  it('reuses an existing command rather than adding a second', () => {
    const program = new Command();
    const existing = program.command('products').description('Hand-written');

    mount(program, spec);

    expect(program.commands.filter((c) => c.name() === 'products')).toHaveLength(1);
    expect(existing.description()).toBe('Hand-written');
  });

  it('leaves an already-registered operation alone', async () => {
    const program = new Command();
    const handler = vi.fn();

    program.command('products').command('list').action(handler);

    mount(program, spec);
    await run(program, ['products', 'list']);

    expect(handler).toHaveBeenCalledOnce();
    expect(client.get).not.toHaveBeenCalled();
  });

  it('still adds the operations the hand-written command lacks', () => {
    const program = new Command();

    program.command('products').command('list').action(vi.fn());

    mount(program, spec);

    expect(names(program.commands[0]!)).toEqual(['create', 'delete', 'get', 'list', 'update']);
  });
});

describe('list', () => {
  const spec: ResourceSpec = {
    name: 'products',
    describe: 'Products',
    path: 'catalog/products',
    style: 'v3-item',
    params: ['sku'],
  };

  function program() {
    const p = new Command();

    p.exitOverride();
    mount(p, spec);

    return p;
  }

  it('unwraps the V3 data envelope', async () => {
    client.get.mockResolvedValue({ data: [{ id: 1 }] });

    await run(program(), ['products', 'list']);

    expect(client.get).toHaveBeenCalledWith('v3', 'catalog/products', {});
    expect(printed[0]).toEqual([{ id: 1 }]);
  });

  it('passes a declared filter through as a query parameter', async () => {
    await run(program(), ['products', 'list', '--sku', 'A-1']);

    expect(client.get).toHaveBeenCalledWith('v3', 'catalog/products', { sku: 'A-1' });
  });

  it('accepts repeated --query pairs', async () => {
    await run(program(), ['products', 'list', '--query', 'a=1', '--query', 'b=2']);

    expect(client.get).toHaveBeenCalledWith('v3', 'catalog/products', { a: '1', b: '2' });
  });

  it('keeps everything after the first = in a --query value', async () => {
    await run(program(), ['products', 'list', '--query', 'id:in=1,2=3']);

    expect(client.get).toHaveBeenCalledWith('v3', 'catalog/products', { 'id:in': '1,2=3' });
  });

  it('rejects a --query value with no =', async () => {
    await expect(run(program(), ['products', 'list', '--query', 'nope'])).rejects.toThrow(
      /expects key=value/,
    );
  });

  it('forwards page and limit', async () => {
    await run(program(), ['products', 'list', '--page', '2', '--limit', '5']);

    expect(client.get).toHaveBeenCalledWith('v3', 'catalog/products', { page: '2', limit: '5' });
  });

  it('switches to auto-pagination with --all', async () => {
    client.getAllV3.mockResolvedValue([{ id: 1 }]);

    await run(program(), ['products', 'list', '--all']);

    expect(client.getAllV3).toHaveBeenCalledWith('catalog/products', {});
    expect(client.get).not.toHaveBeenCalled();
  });

  it('uses the V2 paginator for a V2 resource', async () => {
    const p = new Command();

    mount(p, { name: 'orders', describe: 'Orders', path: 'orders', style: 'v2-item' });
    await run(p, ['orders', 'list', '--all']);

    expect(client.getAllV2).toHaveBeenCalledWith('orders', {});
  });

  it('does not unwrap a V2 response', async () => {
    const p = new Command();

    client.get.mockResolvedValue([{ id: 1 }]);
    mount(p, { name: 'orders', describe: 'Orders', path: 'orders', style: 'v2-item' });
    await run(p, ['orders', 'list']);

    expect(printed[0]).toEqual([{ id: 1 }]);
  });

  it('turns a V2 204 into an empty list', async () => {
    const p = new Command();

    client.get.mockResolvedValue(null);
    mount(p, { name: 'orders', describe: 'Orders', path: 'orders', style: 'v2-item' });
    await run(p, ['orders', 'list']);

    expect(printed[0]).toEqual([]);
  });

  it('omits paging options when the endpoint ignores them', async () => {
    const p = new Command();

    mount(p, {
      name: 'zones',
      describe: 'Zones',
      path: 'tax/zones',
      style: 'v3-item',
      paginate: false,
    });

    const list = p.commands[0]!.commands.find((c) => c.name() === 'list')!;

    expect(list.options.map((o) => o.long)).not.toContain('--all');
  });

  it('requires a parent id when the path has a placeholder', async () => {
    const p = new Command();

    p.exitOverride();
    mount(p, {
      name: 'images',
      describe: 'Images',
      path: 'catalog/products/{product_id}/images',
      style: 'v3-item',
    });

    await expect(run(p, ['images', 'list'])).rejects.toThrow(/product-id/);
  });

  it('fills a path placeholder from its option', async () => {
    const p = new Command();

    mount(p, {
      name: 'images',
      describe: 'Images',
      path: 'catalog/products/{product_id}/images',
      style: 'v3-item',
    });
    await run(p, ['images', 'list', '--product-id', '329']);

    expect(client.get).toHaveBeenCalledWith('v3', 'catalog/products/329/images', {});
  });

  it('url-encodes a placeholder value', async () => {
    const p = new Command();

    mount(p, {
      name: 'routes',
      describe: 'Routes',
      path: 'sites/{site_id}/routes',
      style: 'v3-item',
    });
    await run(p, ['routes', 'list', '--site-id', 'a b/c']);

    expect(client.get).toHaveBeenCalledWith('v3', 'sites/a%20b%2Fc/routes', {});
  });

  it('reports an API failure as a CliError', async () => {
    client.get.mockRejectedValue(new Error('401: Unauthorized'));

    await expect(run(program(), ['products', 'list'])).rejects.toThrow(CliError);
  });

  it('passes --profile through to the client factory', async () => {
    await run(program(), ['products', 'list', '--profile', 'staging']);

    expect(createClient).toHaveBeenCalledWith('staging');
  });
});

describe('get', () => {
  it('appends the id to the path', async () => {
    const p = new Command();

    client.get.mockResolvedValue({ data: { id: 7 } });
    mount(p, { name: 'products', describe: 'P', path: 'catalog/products', style: 'v3-item' });
    await run(p, ['products', 'get', '7']);

    expect(client.get).toHaveBeenCalledWith('v3', 'catalog/products/7', {});
    expect(printed[0]).toEqual({ id: 7 });
  });

  it('omits the id for a singleton', async () => {
    const p = new Command();

    client.get.mockResolvedValue({ data: { enabled: true } });
    mount(p, { name: 'settings', describe: 'S', path: 'settings/x', style: 'v3-singleton' });
    await run(p, ['settings', 'get']);

    expect(client.get).toHaveBeenCalledWith('v3', 'settings/x', {});
  });

  it('filters by id on a batch resource', async () => {
    const p = new Command();

    client.get.mockResolvedValue({ data: [{ id: 3 }] });
    mount(p, {
      name: 'categories',
      describe: 'C',
      path: 'catalog/trees/categories',
      style: 'v3-batch',
    });
    await run(p, ['categories', 'get', '3']);

    expect(client.get).toHaveBeenCalledWith('v3', 'catalog/trees/categories', { 'id:in': '3' });
    expect(printed[0]).toEqual({ id: 3 });
  });

  it('errors when a batch lookup matches nothing', async () => {
    const p = new Command();

    client.get.mockResolvedValue({ data: [] });
    mount(p, {
      name: 'categories',
      describe: 'C',
      path: 'catalog/trees/categories',
      style: 'v3-batch',
    });

    await expect(run(p, ['categories', 'get', '99'])).rejects.toThrow(/categories 99 not found/);
  });
});

describe('create', () => {
  const spec: ResourceSpec = {
    name: 'products',
    describe: 'P',
    path: 'catalog/products',
    style: 'v3-item',
  };

  it('posts an inline JSON body', async () => {
    const p = new Command();

    mount(p, spec);
    await run(p, ['products', 'create', '--data', '{"name":"Widget"}']);

    expect(client.request).toHaveBeenCalledWith('POST', 'v3/catalog/products', {
      body: { name: 'Widget' },
      params: {},
    });
  });

  it('demands a body', async () => {
    const p = new Command();

    mount(p, spec);

    await expect(run(p, ['products', 'create'])).rejects.toThrow(/--data <json> or --file/);
  });

  it('surfaces malformed JSON', async () => {
    const p = new Command();

    mount(p, spec);

    await expect(run(p, ['products', 'create', '--data', '{oops'])).rejects.toThrow();
  });

  it('wraps a single object in an array for a batch resource', async () => {
    const p = new Command();

    client.request.mockResolvedValue({ data: [{ id: 1 }] });
    mount(p, {
      name: 'categories',
      describe: 'C',
      path: 'catalog/trees/categories',
      style: 'v3-batch',
    });
    await run(p, ['categories', 'create', '--data', '{"name":"Hats"}']);

    expect(client.request).toHaveBeenCalledWith('POST', 'v3/catalog/trees/categories', {
      body: [{ name: 'Hats' }],
      params: {},
    });
  });
});

describe('update', () => {
  it('puts to the id path', async () => {
    const p = new Command();

    mount(p, { name: 'products', describe: 'P', path: 'catalog/products', style: 'v3-item' });
    await run(p, ['products', 'update', '7', '--data', '{"name":"New"}']);

    expect(client.request).toHaveBeenCalledWith('PUT', 'v3/catalog/products/7', {
      body: { name: 'New' },
      params: {},
    });
  });

  it('omits the id for a singleton', async () => {
    const p = new Command();

    mount(p, { name: 'settings', describe: 'S', path: 'settings/x', style: 'v3-singleton' });
    await run(p, ['settings', 'update', '--data', '{"a":1}']);

    expect(client.request).toHaveBeenCalledWith('PUT', 'v3/settings/x', {
      body: { a: 1 },
      params: {},
    });
  });

  it('injects a numeric id into the batch body', async () => {
    const p = new Command();

    client.request.mockResolvedValue({ data: [{ id: 3 }] });
    mount(p, {
      name: 'categories',
      describe: 'C',
      path: 'catalog/trees/categories',
      style: 'v3-batch',
    });
    await run(p, ['categories', 'update', '3', '--data', '{"name":"Hats"}']);

    expect(client.request).toHaveBeenCalledWith('PUT', 'v3/catalog/trees/categories', {
      body: [{ name: 'Hats', id: 3 }],
      params: {},
    });
  });

  it('keeps a non-numeric batch id as a string', async () => {
    const p = new Command();

    client.request.mockResolvedValue({ data: [{}] });
    mount(p, { name: 'widgets', describe: 'W', path: 'content/widgets', style: 'v3-batch' });
    await run(p, ['widgets', 'update', 'abc-uuid', '--data', '{}']);

    expect(client.request).toHaveBeenCalledWith('PUT', 'v3/content/widgets', {
      body: [{ id: 'abc-uuid' }],
      params: {},
    });
  });

  it('accepts an array body with no id', async () => {
    const p = new Command();

    client.request.mockResolvedValue({ data: [{ id: 1 }, { id: 2 }] });
    mount(p, {
      name: 'categories',
      describe: 'C',
      path: 'catalog/trees/categories',
      style: 'v3-batch',
    });
    await run(p, ['categories', 'update', '--data', '[{"id":1},{"id":2}]']);

    expect(client.request).toHaveBeenCalledWith('PUT', 'v3/catalog/trees/categories', {
      body: [{ id: 1 }, { id: 2 }],
      params: {},
    });
  });

  it('rejects a batch update with neither an id nor an array', async () => {
    const p = new Command();

    mount(p, {
      name: 'categories',
      describe: 'C',
      path: 'catalog/trees/categories',
      style: 'v3-batch',
    });

    await expect(run(p, ['categories', 'update', '--data', '{"name":"x"}'])).rejects.toThrow(
      /Provide an ID/,
    );
  });
});

describe('delete', () => {
  it('deletes by id', async () => {
    const p = new Command();

    mount(p, { name: 'products', describe: 'P', path: 'catalog/products', style: 'v3-item' });
    await run(p, ['products', 'delete', '7']);

    expect(client.del).toHaveBeenCalledWith('v3', 'catalog/products/7');
  });

  it('deletes a batch resource through a filter', async () => {
    const p = new Command();

    mount(p, {
      name: 'categories',
      describe: 'C',
      path: 'catalog/trees/categories',
      style: 'v3-batch',
    });
    await run(p, ['categories', 'delete', '3']);

    expect(client.del).toHaveBeenCalledWith('v3', 'catalog/trees/categories', { 'id:in': '3' });
  });

  it('honours a custom delete filter key', async () => {
    const p = new Command();

    mount(p, {
      name: 'records',
      describe: 'R',
      path: 'pricelists/{price_list_id}/records',
      style: 'v3-batch',
      deleteQuery: 'variant_id:in',
    });
    await run(p, ['records', 'delete', '9', '--price-list-id', '3']);

    expect(client.del).toHaveBeenCalledWith('v3', 'pricelists/3/records', {
      'variant_id:in': '9',
    });
  });
});

describe('delete-many guard', () => {
  const spec: ResourceSpec = {
    name: 'products',
    describe: 'Products',
    path: 'catalog/products',
    style: 'v3-item',
    ops: ['delete-many'],
    params: ['sku'],
  };

  it('refuses an unfiltered wipe', async () => {
    const p = new Command();

    mount(p, spec);

    await expect(run(p, ['products', 'delete-many'])).rejects.toThrow(
      /deletes all products in the store\. Narrow it/,
    );
    expect(client.del).not.toHaveBeenCalled();
  });

  it('allows an unfiltered wipe with --yes', async () => {
    const p = new Command();

    mount(p, spec);
    await run(p, ['products', 'delete-many', '--yes']);

    expect(client.del).toHaveBeenCalledWith('v3', 'catalog/products', {});
  });

  it('allows a filtered delete without --yes', async () => {
    const p = new Command();

    mount(p, spec);
    await run(p, ['products', 'delete-many', '--query', 'id:in=1,2']);

    expect(client.del).toHaveBeenCalledWith('v3', 'catalog/products', { 'id:in': '1,2' });
  });

  it('counts a declared filter as narrowing', async () => {
    const p = new Command();

    mount(p, spec);
    await run(p, ['products', 'delete-many', '--sku', 'A-1']);

    expect(client.del).toHaveBeenCalledWith('v3', 'catalog/products', { sku: 'A-1' });
  });
});

describe('actions', () => {
  it('sends a body when the action declares one', async () => {
    const p = new Command();

    mount(p, {
      name: 'themes',
      describe: 'T',
      actions: [
        {
          name: 'activate',
          describe: 'Activate',
          method: 'POST',
          path: 'v3/themes/actions/activate',
          body: true,
        },
      ],
    });
    await run(p, ['themes', 'activate', '--data', '{"uuid":"x"}']);

    expect(client.request).toHaveBeenCalledWith('POST', 'v3/themes/actions/activate', {
      body: { uuid: 'x' },
      params: {},
    });
  });

  it('takes declared args positionally', async () => {
    const p = new Command();

    mount(p, {
      name: 'orders',
      describe: 'O',
      actions: [
        {
          name: 'capture',
          describe: 'Capture',
          method: 'POST',
          path: 'v3/orders/{order_id}/payment_actions/capture',
          args: ['order_id'],
        },
      ],
    });
    await run(p, ['orders', 'capture', '145']);

    expect(client.request).toHaveBeenCalledWith('POST', 'v3/orders/145/payment_actions/capture', {
      body: undefined,
      params: {},
    });
  });

  it('uploads a file as multipart', async () => {
    const p = new Command();

    mount(p, {
      name: 'logo',
      describe: 'L',
      actions: [
        {
          name: 'set',
          describe: 'Set the logo',
          method: 'POST',
          path: 'v3/store/logo/image',
          upload: { field: 'image_file' },
        },
      ],
    });
    await run(p, ['logo', 'set', '--file', './logo.png']);

    expect(client.requestMultipart).toHaveBeenCalledWith('POST', 'v3/store/logo/image', {
      image_file: { filePath: './logo.png' },
    });
  });

  it('sends a remote URL as JSON when the action allows it', async () => {
    const p = new Command();

    mount(p, {
      name: 'images',
      describe: 'I',
      actions: [
        {
          name: 'add',
          describe: 'Add an image',
          method: 'POST',
          path: 'v3/catalog/products/{product_id}/images',
          upload: { field: 'image_file', urlField: 'image_url' },
        },
      ],
    });
    await run(p, ['images', 'add', '--product-id', '1', '--url', 'https://x.test/a.png']);

    expect(client.request).toHaveBeenCalledWith('POST', 'v3/catalog/products/1/images', {
      body: { image_url: 'https://x.test/a.png' },
      params: {},
    });
  });

  it('demands one of --file or --url', async () => {
    const p = new Command();

    mount(p, {
      name: 'images',
      describe: 'I',
      actions: [
        {
          name: 'add',
          describe: 'Add',
          method: 'POST',
          path: 'v3/catalog/products/1/images',
          upload: { field: 'image_file', urlField: 'image_url' },
        },
      ],
    });

    await expect(run(p, ['images', 'add'])).rejects.toThrow(/--file <path> or --url <url>/);
  });

  it('demands --file when the action takes no URL', async () => {
    const p = new Command();

    mount(p, {
      name: 'themes',
      describe: 'T',
      actions: [
        {
          name: 'upload',
          describe: 'Upload',
          method: 'POST',
          path: 'v3/themes',
          upload: { field: 'file' },
        },
      ],
    });

    await expect(run(p, ['themes', 'upload'])).rejects.toThrow(/Provide --file <path>/);
  });

  it('streams a download to --out', async () => {
    const p = new Command();

    mount(p, {
      name: 'themes',
      describe: 'T',
      actions: [
        {
          name: 'download',
          describe: 'Download',
          method: 'POST',
          path: 'v3/themes/{uuid}/actions/download',
          args: ['uuid'],
          download: true,
        },
      ],
    });
    await run(p, ['themes', 'download', 'abc', '--out', './theme.zip']);

    expect(client.download).toHaveBeenCalledWith('v3/themes/abc/actions/download', './theme.zip');
    expect(printed[0]).toEqual({ file: './theme.zip' });
  });

  it('leaves a V2 action response wrapped', async () => {
    const p = new Command();

    client.request.mockResolvedValue({ data: { id: 1 } });
    mount(p, {
      name: 'coupons',
      describe: 'C',
      actions: [{ name: 'ping', describe: 'Ping', method: 'GET', path: 'v2/coupons/ping' }],
    });
    await run(p, ['coupons', 'ping']);

    expect(printed[0]).toEqual({ data: { id: 1 } });
  });

  it('unwraps a V3 action response', async () => {
    const p = new Command();

    client.request.mockResolvedValue({ data: { id: 1 } });
    mount(p, {
      name: 'themes',
      describe: 'T',
      actions: [{ name: 'jobs', describe: 'Jobs', method: 'GET', path: 'v3/themes/jobs' }],
    });
    await run(p, ['themes', 'jobs']);

    expect(printed[0]).toEqual({ id: 1 });
  });

  it('honours an explicit envelope override', async () => {
    const p = new Command();

    client.request.mockResolvedValue({ data: { id: 1 } });
    mount(p, {
      name: 'themes',
      describe: 'T',
      actions: [
        {
          name: 'jobs',
          describe: 'Jobs',
          method: 'GET',
          path: 'v3/themes/jobs',
          envelope: false,
        },
      ],
    });
    await run(p, ['themes', 'jobs']);

    expect(printed[0]).toEqual({ data: { id: 1 } });
  });

  it('prints nothing when the action returns no content', async () => {
    const p = new Command();

    client.request.mockResolvedValue(null);
    mount(p, {
      name: 'themes',
      describe: 'T',
      actions: [{ name: 'purge', describe: 'Purge', method: 'DELETE', path: 'v3/themes/cache' }],
    });
    await run(p, ['themes', 'purge']);

    expect(printed).toHaveLength(0);
  });
});

describe('shared query helpers', () => {
  it('adds a named option per declared parameter', () => {
    const cmd = queryOption(new Command('list'), ['sku', 'price_list_id']);
    const longs = cmd.options.map((o) => o.long);

    expect(longs).toContain('--sku');
    expect(longs).toContain('--price-list-id');
    expect(longs).toContain('--query');
  });

  it('reads declared options and --query back out together', () => {
    expect(queryParams({ sku: 'A-1', query: { limit: '5' }, other: 'x' }, ['sku'])).toEqual({
      sku: 'A-1',
      limit: '5',
    });
  });

  it('drops parameters the user did not supply', () => {
    expect(queryParams({ query: {} }, ['sku'])).toEqual({});
  });

  it('survives a missing query object', () => {
    expect(queryParams({ sku: 'A-1' }, ['sku'])).toEqual({ sku: 'A-1' });
  });
});

describe('the real resource tree', () => {
  const program = new Command();

  mountAll(program, RESOURCES);

  function walk(cmd: Command, prefix: string, out: string[]): void {
    for (const c of cmd.commands) {
      const full = prefix ? `${prefix} ${c.name()}` : c.name();

      out.push(full);
      walk(c, full, out);
    }
  }

  const all: string[] = [];

  walk(program, '', all);

  it('mounts a substantial command tree', () => {
    expect(all.length).toBeGreaterThan(500);
  });

  it('mounts every top-level group exactly once', () => {
    const top = program.commands.map((c) => c.name());

    expect(new Set(top).size).toBe(top.length);
  });

  it('never registers the same command path twice', () => {
    expect(new Set(all).size).toBe(all.length);
  });

  it('gives every command a description', () => {
    const bare: string[] = [];

    function check(cmd: Command, prefix: string): void {
      for (const c of cmd.commands) {
        const full = prefix ? `${prefix} ${c.name()}` : c.name();

        if (!c.description()) {
          bare.push(full);
        }

        check(c, full);
      }
    }

    check(program, '');

    expect(bare).toEqual([]);
  });

  it('covers the documented top-level groups', () => {
    const top = program.commands.map((c) => c.name());

    for (const group of [
      'catalog',
      'orders',
      'customers',
      'channels',
      'sites',
      'inventory',
      'pricelists',
      'promotions',
      'carts',
      'checkouts',
      'payments',
      'storefront',
      'content',
      'themes',
      'marketing',
      'settings',
      'tax',
      'shipping',
      'webhooks',
    ]) {
      expect(top).toContain(group);
    }
  });
});
