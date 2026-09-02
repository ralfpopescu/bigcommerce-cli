import * as fs from 'fs';
import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { getProfile } from '../config';
import { ApiClient, MultipartField } from '../api/client';
import { print, success, errorOut, OutputFormat } from '../output';
import { queryOption, queryParams } from '../resource';
import { paramsFor } from '../resources';

const PRODUCT_FIELDS = ['id', 'name', 'sku', 'type', 'price', 'availability', 'inventory_level', 'is_visible'];
const CATEGORY_FIELDS = ['id', 'name', 'parent_id', 'sort_order', 'is_visible'];
const BRAND_FIELDS = ['id', 'name', 'page_title'];
const VARIANT_FIELDS = ['id', 'sku', 'price', 'cost_price', 'weight', 'inventory_level', 'purchasing_disabled'];
const IMAGE_FIELDS = ['id', 'product_id', 'is_thumbnail', 'sort_order', 'description', 'url_thumbnail'];

function client(profile?: string): ApiClient {
  const p = getProfile(profile);
  return new ApiClient(p.storeHash, p.accessToken);
}

function parseInput(opts: { data?: string; file?: string }): unknown {
  if (opts.data) return JSON.parse(opts.data);
  if (opts.file) return JSON.parse(fs.readFileSync(opts.file, 'utf-8'));
  throw new Error('Provide --data <json> or --file <path>');
}

function addOpts(cmd: Command): Command {
  return cmd
    .option('-o, --output <format>', 'output format: json|table|pretty', 'pretty')
    .option('--profile <name>', 'credential profile');
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

function imageFields(opts: {
  description?: string;
  isThumbnail?: boolean;
  sortOrder?: string;
}): Record<string, MultipartField | undefined> {
  return {
    description: opts.description,
    is_thumbnail: opts.isThumbnail,
    sort_order: opts.sortOrder !== undefined ? parseInt(opts.sortOrder, 10) : undefined,
  };
}

async function uploadProductImages(
  bc: ApiClient,
  productId: number | string,
  files: string[],
  urls: string[],
): Promise<{ uploaded: number; failures: { source: string; error: string }[] }> {
  const failures: { source: string; error: string }[] = [];
  let uploaded = 0;

  for (const filePath of files) {
    try {
      if (!fs.existsSync(filePath)) throw new Error('file not found');
      await bc.postMultipart('v3', `catalog/products/${productId}/images`, {
        image_file: { filePath },
      });
      uploaded++;
    } catch (e) {
      failures.push({ source: filePath, error: (e as Error).message });
    }
  }

  for (const url of urls) {
    try {
      await bc.post('v3', `catalog/products/${productId}/images`, { image_url: url });
      uploaded++;
    } catch (e) {
      failures.push({ source: url, error: (e as Error).message });
    }
  }

  return { uploaded, failures };
}

function reportImageResult(result: { uploaded: number; failures: { source: string; error: string }[] }): void {
  if (result.uploaded > 0) success(`Uploaded ${result.uploaded} image(s)`);
  for (const f of result.failures) {
    console.error(chalk.yellow(`! image upload failed (${f.source}): ${f.error}`));
  }
}

export function registerCatalog(program: Command): void {
  const catalog = program.command('catalog').description('Manage the product catalog');

  // ── Products ──────────────────────────────────────────────────────────────

  const products = catalog.command('products').description('Manage products');

  addOpts(
    queryOption(
      products
        .command('list')
        .description('List products')
        .option('--page <n>', 'page number', '1')
        .option('--limit <n>', 'results per page (max 250)', '50')
        .option('--all', 'fetch all pages'),
      paramsFor('catalog', 'products')
    )
  ).action(async (opts: { page: string; limit: string; all?: boolean; query: Record<string, string>; output: OutputFormat; profile?: string }) => {
    const spinner = ora('Fetching products...').start();
    try {
      const bc = client(opts.profile);
      const filters = queryParams(opts, paramsFor('catalog', 'products'));
      let data: unknown;
      if (opts.all) {
        data = await bc.getAllV3('catalog/products', filters);
      } else {
        const res = await bc.get('v3', 'catalog/products', { ...filters, page: opts.page, limit: opts.limit }) as { data: unknown[] };
        data = res.data;
      }
      spinner.stop();
      print(data, opts.output, PRODUCT_FIELDS);
    } catch (e) {
      spinner.fail();
      errorOut((e as Error).message);
    }
  });

  addOpts(
    products
      .command('get')
      .description('Get a product by ID')
      .argument('<id>', 'product ID')
  ).action(async (id: string, opts: { output: OutputFormat; profile?: string }) => {
    try {
      const bc = client(opts.profile);
      const res = await bc.get('v3', `catalog/products/${id}`) as { data: unknown };
      print(res.data, opts.output);
    } catch (e) {
      errorOut((e as Error).message);
    }
  });

  addOpts(
    products
      .command('create')
      .description('Create a product')
      .option('--data <json>', 'product JSON')
      .option('--file <path>', 'path to JSON file')
      .option('--image-file <path>', 'local image file to upload (repeatable)', collect, [] as string[])
      .option('--image-url <url>', 'remote image URL to attach (repeatable)', collect, [] as string[])
  ).action(async (opts: {
    data?: string;
    file?: string;
    imageFile: string[];
    imageUrl: string[];
    output: OutputFormat;
    profile?: string;
  }) => {
    const spinner = ora('Creating product...').start();
    try {
      const bc = client(opts.profile);
      const body = parseInput(opts);
      const res = await bc.post('v3', 'catalog/products', body) as { data: { id: number } & Record<string, unknown> };
      const product = res.data;
      spinner.stop();
      success(`Product created (id ${product.id})`);

      if (opts.imageFile.length > 0 || opts.imageUrl.length > 0) {
        const imgSpinner = ora(`Uploading ${opts.imageFile.length + opts.imageUrl.length} image(s)...`).start();
        const result = await uploadProductImages(bc, product.id, opts.imageFile, opts.imageUrl);
        imgSpinner.stop();
        reportImageResult(result);
      }

      print(product, opts.output);
    } catch (e) {
      spinner.fail();
      errorOut((e as Error).message);
    }
  });

  addOpts(
    products
      .command('update')
      .description('Update a product')
      .argument('<id>', 'product ID')
      .option('--data <json>', 'fields to update as JSON')
      .option('--file <path>', 'path to JSON file')
      .option('--image-file <path>', 'local image file to upload (repeatable)', collect, [] as string[])
      .option('--image-url <url>', 'remote image URL to attach (repeatable)', collect, [] as string[])
  ).action(async (id: string, opts: {
    data?: string;
    file?: string;
    imageFile: string[];
    imageUrl: string[];
    output: OutputFormat;
    profile?: string;
  }) => {
    const spinner = ora('Updating product...').start();
    try {
      const bc = client(opts.profile);
      const hasMetadata = opts.data || opts.file;
      let product: unknown = null;
      if (hasMetadata) {
        const body = parseInput(opts);
        const res = await bc.put('v3', `catalog/products/${id}`, body) as { data: unknown };
        product = res.data;
      }
      spinner.stop();
      if (hasMetadata) success(`Product ${id} updated`);

      if (opts.imageFile.length > 0 || opts.imageUrl.length > 0) {
        const imgSpinner = ora(`Uploading ${opts.imageFile.length + opts.imageUrl.length} image(s)...`).start();
        const result = await uploadProductImages(bc, id, opts.imageFile, opts.imageUrl);
        imgSpinner.stop();
        reportImageResult(result);
      } else if (!hasMetadata) {
        errorOut('Nothing to update. Provide --data, --file, --image-file, or --image-url.');
      }

      if (product) print(product, opts.output);
    } catch (e) {
      spinner.fail();
      errorOut((e as Error).message);
    }
  });

  addOpts(
    products
      .command('delete')
      .description('Delete a product')
      .argument('<id>', 'product ID')
  ).action(async (id: string, opts: { output: OutputFormat; profile?: string }) => {
    const spinner = ora('Deleting product...').start();
    try {
      const bc = client(opts.profile);
      await bc.del('v3', `catalog/products/${id}`);
      spinner.stop();
      success(`Product ${id} deleted`);
    } catch (e) {
      spinner.fail();
      errorOut((e as Error).message);
    }
  });

  // ── Product images ────────────────────────────────────────────────────────

  const images = products.command('images').description('Manage product images');

  addOpts(
    images
      .command('list')
      .description('List images for a product')
      .requiredOption('--product-id <id>', 'product ID')
      .option('--all', 'fetch all pages')
  ).action(async (opts: { productId: string; all?: boolean; output: OutputFormat; profile?: string }) => {
    const spinner = ora('Fetching images...').start();
    try {
      const bc = client(opts.profile);
      let data: unknown;
      if (opts.all) {
        data = await bc.getAllV3(`catalog/products/${opts.productId}/images`);
      } else {
        const res = await bc.get('v3', `catalog/products/${opts.productId}/images`) as { data: unknown[] };
        data = res.data;
      }
      spinner.stop();
      print(data, opts.output, IMAGE_FIELDS);
    } catch (e) {
      spinner.fail();
      errorOut((e as Error).message);
    }
  });

  addOpts(
    images
      .command('add')
      .description('Add an image to a product (provide --file or --url)')
      .requiredOption('--product-id <id>', 'product ID')
      .option('--file <path>', 'local image file (multipart upload)')
      .option('--url <url>', 'remote image URL')
      .option('--description <text>', 'image description / alt text')
      .option('--is-thumbnail', 'mark as the product thumbnail')
      .option('--sort-order <n>', 'display order')
  ).action(async (opts: {
    productId: string;
    file?: string;
    url?: string;
    description?: string;
    isThumbnail?: boolean;
    sortOrder?: string;
    output: OutputFormat;
    profile?: string;
  }) => {
    if (!opts.file && !opts.url) errorOut('Provide --file <path> or --url <url>');
    if (opts.file && opts.url) errorOut('Provide --file or --url, not both');

    const spinner = ora('Uploading image...').start();
    try {
      const bc = client(opts.profile);
      const resource = `catalog/products/${opts.productId}/images`;
      let res: { data: unknown };

      if (opts.file) {
        if (!fs.existsSync(opts.file)) throw new Error(`File not found: ${opts.file}`);
        res = await bc.postMultipart('v3', resource, {
          ...imageFields(opts),
          image_file: { filePath: opts.file },
        }) as { data: unknown };
      } else {
        const body: Record<string, unknown> = { image_url: opts.url };
        if (opts.description !== undefined) body.description = opts.description;
        if (opts.isThumbnail) body.is_thumbnail = true;
        if (opts.sortOrder !== undefined) body.sort_order = parseInt(opts.sortOrder, 10);
        res = await bc.post('v3', resource, body) as { data: unknown };
      }

      spinner.stop();
      success('Image uploaded');
      print(res.data, opts.output);
    } catch (e) {
      spinner.fail();
      errorOut((e as Error).message);
    }
  });

  addOpts(
    images
      .command('update')
      .description('Update an image on a product')
      .requiredOption('--product-id <id>', 'product ID')
      .argument('<image-id>', 'image ID')
      .option('--file <path>', 'replace image with local file')
      .option('--url <url>', 'replace image with remote URL')
      .option('--description <text>', 'image description / alt text')
      .option('--is-thumbnail', 'mark as the product thumbnail')
      .option('--sort-order <n>', 'display order')
  ).action(async (imageId: string, opts: {
    productId: string;
    file?: string;
    url?: string;
    description?: string;
    isThumbnail?: boolean;
    sortOrder?: string;
    output: OutputFormat;
    profile?: string;
  }) => {
    if (opts.file && opts.url) errorOut('Provide --file or --url, not both');

    const spinner = ora('Updating image...').start();
    try {
      const bc = client(opts.profile);
      const resource = `catalog/products/${opts.productId}/images/${imageId}`;
      let res: { data: unknown };

      if (opts.file) {
        if (!fs.existsSync(opts.file)) throw new Error(`File not found: ${opts.file}`);
        res = await bc.putMultipart('v3', resource, {
          ...imageFields(opts),
          image_file: { filePath: opts.file },
        }) as { data: unknown };
      } else {
        const body: Record<string, unknown> = {};
        if (opts.url) body.image_url = opts.url;
        if (opts.description !== undefined) body.description = opts.description;
        if (opts.isThumbnail) body.is_thumbnail = true;
        if (opts.sortOrder !== undefined) body.sort_order = parseInt(opts.sortOrder, 10);
        res = await bc.put('v3', resource, body) as { data: unknown };
      }

      spinner.stop();
      success(`Image ${imageId} updated`);
      print(res.data, opts.output);
    } catch (e) {
      spinner.fail();
      errorOut((e as Error).message);
    }
  });

  addOpts(
    images
      .command('delete')
      .description('Delete an image from a product')
      .requiredOption('--product-id <id>', 'product ID')
      .argument('<image-id>', 'image ID')
  ).action(async (imageId: string, opts: { productId: string; output: OutputFormat; profile?: string }) => {
    const spinner = ora('Deleting image...').start();
    try {
      const bc = client(opts.profile);
      await bc.del('v3', `catalog/products/${opts.productId}/images/${imageId}`);
      spinner.stop();
      success(`Image ${imageId} deleted`);
    } catch (e) {
      spinner.fail();
      errorOut((e as Error).message);
    }
  });

  // ── Categories ────────────────────────────────────────────────────────────

  const categories = catalog.command('categories').description('Manage categories');

  addOpts(
    queryOption(
      categories
        .command('list')
        .description('List categories')
        .option('--all', 'fetch all pages'),
      paramsFor('catalog', 'categories')
    )
  ).action(async (opts: { all?: boolean; query: Record<string, string>; output: OutputFormat; profile?: string }) => {
    const spinner = ora('Fetching categories...').start();
    try {
      const bc = client(opts.profile);
      const filters = queryParams(opts, paramsFor('catalog', 'categories'));
      let data: unknown;
      if (opts.all) {
        data = await bc.getAllV3('catalog/categories', filters);
      } else {
        const res = await bc.get('v3', 'catalog/categories', filters) as { data: unknown[] };
        data = res.data;
      }
      spinner.stop();
      print(data, opts.output, CATEGORY_FIELDS);
    } catch (e) {
      spinner.fail();
      errorOut((e as Error).message);
    }
  });

  addOpts(
    categories
      .command('get')
      .description('Get a category by ID')
      .argument('<id>', 'category ID')
  ).action(async (id: string, opts: { output: OutputFormat; profile?: string }) => {
    try {
      const bc = client(opts.profile);
      const res = await bc.get('v3', `catalog/categories/${id}`) as { data: unknown };
      print(res.data, opts.output);
    } catch (e) {
      errorOut((e as Error).message);
    }
  });

  // Categories use the V3 trees endpoint, which works in arrays.
  // The CLI wraps a single object so the user-facing shape matches `products create`.

  addOpts(
    categories
      .command('create')
      .description('Create a category (requires name, tree_id, parent_id)')
      .option('--data <json>', 'category JSON (object or array)')
      .option('--file <path>', 'path to JSON file')
  ).action(async (opts: { data?: string; file?: string; output: OutputFormat; profile?: string }) => {
    const spinner = ora('Creating category...').start();
    try {
      const bc = client(opts.profile);
      const input = parseInput(opts);
      const body = Array.isArray(input) ? input : [input];
      const res = await bc.post('v3', 'catalog/trees/categories', body) as { data: unknown[] };
      spinner.stop();
      success(`Created ${(res.data ?? []).length} category(ies)`);
      print(res.data, opts.output, CATEGORY_FIELDS);
    } catch (e) {
      spinner.fail();
      errorOut((e as Error).message);
    }
  });

  addOpts(
    categories
      .command('update')
      .description('Update a category')
      .argument('<id>', 'category ID')
      .option('--data <json>', 'fields to update as JSON')
      .option('--file <path>', 'path to JSON file')
  ).action(async (id: string, opts: { data?: string; file?: string; output: OutputFormat; profile?: string }) => {
    const spinner = ora('Updating category...').start();
    try {
      const bc = client(opts.profile);
      const input = parseInput(opts) as Record<string, unknown>;
      const body = [{ ...input, category_id: parseInt(id, 10) }];
      const res = await bc.put('v3', 'catalog/trees/categories', body) as { data: unknown[] };
      spinner.stop();
      success(`Category ${id} updated`);
      print((res.data ?? [])[0], opts.output);
    } catch (e) {
      spinner.fail();
      errorOut((e as Error).message);
    }
  });

  addOpts(
    categories
      .command('delete')
      .description('Delete a category')
      .argument('<id>', 'category ID')
  ).action(async (id: string, opts: { output: OutputFormat; profile?: string }) => {
    const spinner = ora('Deleting category...').start();
    try {
      const bc = client(opts.profile);
      await bc.del('v3', 'catalog/trees/categories', { 'category_id:in': id });
      spinner.stop();
      success(`Category ${id} deleted`);
    } catch (e) {
      spinner.fail();
      errorOut((e as Error).message);
    }
  });

  const categoryImage = categories.command('image').description('Manage the category image');

  addOpts(
    categoryImage
      .command('set')
      .description('Set the category image (provide --file or --url)')
      .requiredOption('--category-id <id>', 'category ID')
      .option('--file <path>', 'local image file (multipart upload)')
      .option('--url <url>', 'remote image URL')
  ).action(async (opts: { categoryId: string; file?: string; url?: string; output: OutputFormat; profile?: string }) => {
    if (!opts.file && !opts.url) errorOut('Provide --file <path> or --url <url>');
    if (opts.file && opts.url) errorOut('Provide --file or --url, not both');

    const spinner = ora('Uploading category image...').start();
    try {
      const bc = client(opts.profile);
      const resource = `catalog/categories/${opts.categoryId}/image`;
      let res: { data: unknown };
      if (opts.file) {
        if (!fs.existsSync(opts.file)) throw new Error(`File not found: ${opts.file}`);
        res = await bc.postMultipart('v3', resource, { image_file: { filePath: opts.file } }) as { data: unknown };
      } else {
        res = await bc.post('v3', resource, { image_url: opts.url }) as { data: unknown };
      }
      spinner.stop();
      success('Category image set');
      print(res.data, opts.output);
    } catch (e) {
      spinner.fail();
      errorOut((e as Error).message);
    }
  });

  addOpts(
    categoryImage
      .command('delete')
      .description('Delete the category image')
      .requiredOption('--category-id <id>', 'category ID')
  ).action(async (opts: { categoryId: string; output: OutputFormat; profile?: string }) => {
    const spinner = ora('Deleting category image...').start();
    try {
      const bc = client(opts.profile);
      await bc.del('v3', `catalog/categories/${opts.categoryId}/image`);
      spinner.stop();
      success(`Category ${opts.categoryId} image deleted`);
    } catch (e) {
      spinner.fail();
      errorOut((e as Error).message);
    }
  });

  // ── Brands ────────────────────────────────────────────────────────────────

  const brands = catalog.command('brands').description('Manage brands');

  addOpts(
    queryOption(
      brands
        .command('list')
        .description('List brands')
        .option('--all', 'fetch all pages'),
      paramsFor('catalog', 'brands')
    )
  ).action(async (opts: { all?: boolean; query: Record<string, string>; output: OutputFormat; profile?: string }) => {
    const spinner = ora('Fetching brands...').start();
    try {
      const bc = client(opts.profile);
      const filters = queryParams(opts, paramsFor('catalog', 'brands'));
      let data: unknown;
      if (opts.all) {
        data = await bc.getAllV3('catalog/brands', filters);
      } else {
        const res = await bc.get('v3', 'catalog/brands', filters) as { data: unknown[] };
        data = res.data;
      }
      spinner.stop();
      print(data, opts.output, BRAND_FIELDS);
    } catch (e) {
      spinner.fail();
      errorOut((e as Error).message);
    }
  });

  addOpts(
    brands
      .command('get')
      .description('Get a brand by ID')
      .argument('<id>', 'brand ID')
  ).action(async (id: string, opts: { output: OutputFormat; profile?: string }) => {
    try {
      const bc = client(opts.profile);
      const res = await bc.get('v3', `catalog/brands/${id}`) as { data: unknown };
      print(res.data, opts.output);
    } catch (e) {
      errorOut((e as Error).message);
    }
  });

  const brandImage = brands.command('image').description('Manage the brand image');

  addOpts(
    brandImage
      .command('set')
      .description('Set the brand image (provide --file or --url)')
      .requiredOption('--brand-id <id>', 'brand ID')
      .option('--file <path>', 'local image file (multipart upload)')
      .option('--url <url>', 'remote image URL')
  ).action(async (opts: { brandId: string; file?: string; url?: string; output: OutputFormat; profile?: string }) => {
    if (!opts.file && !opts.url) errorOut('Provide --file <path> or --url <url>');
    if (opts.file && opts.url) errorOut('Provide --file or --url, not both');

    const spinner = ora('Uploading brand image...').start();
    try {
      const bc = client(opts.profile);
      const resource = `catalog/brands/${opts.brandId}/image`;
      let res: { data: unknown };
      if (opts.file) {
        if (!fs.existsSync(opts.file)) throw new Error(`File not found: ${opts.file}`);
        res = await bc.postMultipart('v3', resource, { image_file: { filePath: opts.file } }) as { data: unknown };
      } else {
        res = await bc.post('v3', resource, { image_url: opts.url }) as { data: unknown };
      }
      spinner.stop();
      success('Brand image set');
      print(res.data, opts.output);
    } catch (e) {
      spinner.fail();
      errorOut((e as Error).message);
    }
  });

  addOpts(
    brandImage
      .command('delete')
      .description('Delete the brand image')
      .requiredOption('--brand-id <id>', 'brand ID')
  ).action(async (opts: { brandId: string; output: OutputFormat; profile?: string }) => {
    const spinner = ora('Deleting brand image...').start();
    try {
      const bc = client(opts.profile);
      await bc.del('v3', `catalog/brands/${opts.brandId}/image`);
      spinner.stop();
      success(`Brand ${opts.brandId} image deleted`);
    } catch (e) {
      spinner.fail();
      errorOut((e as Error).message);
    }
  });

  // ── Variants ──────────────────────────────────────────────────────────────

  const variants = catalog.command('variants').description('Manage product variants');

  addOpts(
    queryOption(
      variants
        .command('list')
        .description('List variants for a product')
        .requiredOption('--product-id <id>', 'product ID')
        .option('--all', 'fetch all pages')
    )
  ).action(async (opts: { productId: string; all?: boolean; query: Record<string, string>; output: OutputFormat; profile?: string }) => {
    const spinner = ora('Fetching variants...').start();
    try {
      const bc = client(opts.profile);
      let data: unknown;
      if (opts.all) {
        data = await bc.getAllV3(`catalog/products/${opts.productId}/variants`, opts.query);
      } else {
        const res = await bc.get('v3', `catalog/products/${opts.productId}/variants`, opts.query) as { data: unknown[] };
        data = res.data;
      }
      spinner.stop();
      print(data, opts.output, VARIANT_FIELDS);
    } catch (e) {
      spinner.fail();
      errorOut((e as Error).message);
    }
  });

  addOpts(
    variants
      .command('get')
      .description('Get a variant by ID')
      .requiredOption('--product-id <id>', 'product ID')
      .argument('<variant-id>', 'variant ID')
  ).action(async (variantId: string, opts: { productId: string; output: OutputFormat; profile?: string }) => {
    try {
      const bc = client(opts.profile);
      const res = await bc.get('v3', `catalog/products/${opts.productId}/variants/${variantId}`) as { data: unknown };
      print(res.data, opts.output);
    } catch (e) {
      errorOut((e as Error).message);
    }
  });

  addOpts(
    variants
      .command('create')
      .description('Create a variant on a product')
      .requiredOption('--product-id <id>', 'product ID')
      .option('--data <json>', 'variant JSON')
      .option('--file <path>', 'path to JSON file')
  ).action(async (opts: { productId: string; data?: string; file?: string; output: OutputFormat; profile?: string }) => {
    const spinner = ora('Creating variant...').start();
    try {
      const bc = client(opts.profile);
      const body = parseInput(opts);
      const res = await bc.post('v3', `catalog/products/${opts.productId}/variants`, body) as { data: unknown };
      spinner.stop();
      success('Variant created');
      print(res.data, opts.output);
    } catch (e) {
      spinner.fail();
      errorOut((e as Error).message);
    }
  });

  addOpts(
    variants
      .command('update')
      .description('Update a variant')
      .requiredOption('--product-id <id>', 'product ID')
      .argument('<variant-id>', 'variant ID')
      .option('--data <json>', 'fields to update as JSON')
      .option('--file <path>', 'path to JSON file')
  ).action(async (variantId: string, opts: { productId: string; data?: string; file?: string; output: OutputFormat; profile?: string }) => {
    const spinner = ora('Updating variant...').start();
    try {
      const bc = client(opts.profile);
      const body = parseInput(opts);
      const res = await bc.put('v3', `catalog/products/${opts.productId}/variants/${variantId}`, body) as { data: unknown };
      spinner.stop();
      success(`Variant ${variantId} updated`);
      print(res.data, opts.output);
    } catch (e) {
      spinner.fail();
      errorOut((e as Error).message);
    }
  });

  addOpts(
    variants
      .command('delete')
      .description('Delete a variant')
      .requiredOption('--product-id <id>', 'product ID')
      .argument('<variant-id>', 'variant ID')
  ).action(async (variantId: string, opts: { productId: string; output: OutputFormat; profile?: string }) => {
    const spinner = ora('Deleting variant...').start();
    try {
      const bc = client(opts.profile);
      await bc.del('v3', `catalog/products/${opts.productId}/variants/${variantId}`);
      spinner.stop();
      success(`Variant ${variantId} deleted`);
    } catch (e) {
      spinner.fail();
      errorOut((e as Error).message);
    }
  });
}
