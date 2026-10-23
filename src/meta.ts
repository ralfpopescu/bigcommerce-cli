import { Command } from 'commander';

/**
 * What a command does over HTTP, for `bigc commands --json`. Generated
 * commands are annotated as they're built; hand-written ones are listed in
 * HAND_WRITTEN below, keyed by their command path.
 */
export interface HttpMeta {
  method: string;
  /** Store-rooted path with {placeholders}, e.g. "/v3/catalog/products/{id}". */
  path: string;
}

export interface CommandMeta {
  http?: HttpMeta;
  /**
   * true for anything that writes. "conditional" for `api` and the GraphQL
   * commands, where it depends on the method or the document.
   */
  mutating?: boolean | 'conditional';
  /** Accepts a request body through --data/--file. */
  body?: boolean;
  /** Uploads a local file as multipart/form-data. */
  multipart?: boolean;
}

const registry = new WeakMap<Command, CommandMeta>();

export function setMeta(cmd: Command, meta: CommandMeta): Command {
  registry.set(cmd, { ...registry.get(cmd), ...meta });
  return cmd;
}

export function getMeta(cmd: Command): CommandMeta | undefined {
  return registry.get(cmd);
}

const P = '/v3/catalog/products';

/** The hand-written commands in src/commands, by full command path. */
export const HAND_WRITTEN: Record<string, CommandMeta> = {
  'api': { mutating: 'conditional', body: true },
  'graphql': { http: { method: 'POST', path: '/graphql' }, mutating: 'conditional' },
  'payments process': { http: { method: 'POST', path: 'https://payments.bigcommerce.com/stores/{store_hash}/payments' }, body: true },

  'catalog products list': { http: { method: 'GET', path: P } },
  'catalog products get': { http: { method: 'GET', path: `${P}/{id}` } },
  'catalog products create': { http: { method: 'POST', path: P }, body: true, multipart: true },
  'catalog products update': { http: { method: 'PUT', path: `${P}/{id}` }, body: true, multipart: true },
  'catalog products delete': { http: { method: 'DELETE', path: `${P}/{id}` } },
  'catalog products images list': { http: { method: 'GET', path: `${P}/{product_id}/images` } },
  'catalog products images add': { http: { method: 'POST', path: `${P}/{product_id}/images` }, multipart: true },
  'catalog products images update': { http: { method: 'PUT', path: `${P}/{product_id}/images/{image_id}` }, multipart: true },
  'catalog products images delete': { http: { method: 'DELETE', path: `${P}/{product_id}/images/{image_id}` } },

  'catalog categories list': { http: { method: 'GET', path: '/v3/catalog/categories' } },
  'catalog categories get': { http: { method: 'GET', path: '/v3/catalog/categories/{id}' } },
  'catalog categories create': { http: { method: 'POST', path: '/v3/catalog/trees/categories' }, body: true },
  'catalog categories update': { http: { method: 'PUT', path: '/v3/catalog/trees/categories' }, body: true },
  'catalog categories delete': { http: { method: 'DELETE', path: '/v3/catalog/trees/categories?category_id:in={id}' } },
  'catalog categories image set': { http: { method: 'POST', path: '/v3/catalog/categories/{category_id}/image' }, multipart: true },
  'catalog categories image delete': { http: { method: 'DELETE', path: '/v3/catalog/categories/{category_id}/image' } },

  'catalog brands list': { http: { method: 'GET', path: '/v3/catalog/brands' } },
  'catalog brands get': { http: { method: 'GET', path: '/v3/catalog/brands/{id}' } },
  'catalog brands image set': { http: { method: 'POST', path: '/v3/catalog/brands/{brand_id}/image' }, multipart: true },
  'catalog brands image delete': { http: { method: 'DELETE', path: '/v3/catalog/brands/{brand_id}/image' } },

  'catalog variants list': { http: { method: 'GET', path: `${P}/{product_id}/variants` } },
  'catalog variants get': { http: { method: 'GET', path: `${P}/{product_id}/variants/{variant_id}` } },
  'catalog variants create': { http: { method: 'POST', path: `${P}/{product_id}/variants` }, body: true },
  'catalog variants update': { http: { method: 'PUT', path: `${P}/{product_id}/variants/{variant_id}` }, body: true },
  'catalog variants delete': { http: { method: 'DELETE', path: `${P}/{product_id}/variants/{variant_id}` } },

  'orders list': { http: { method: 'GET', path: '/v2/orders' } },
  'orders get': { http: { method: 'GET', path: '/v2/orders/{id}' } },
  'orders update': { http: { method: 'PUT', path: '/v2/orders/{id}' }, body: true },

  'customers list': { http: { method: 'GET', path: '/v3/customers' } },
  'customers get': { http: { method: 'GET', path: '/v3/customers?id:in={id}' } },
  'customers create': { http: { method: 'POST', path: '/v3/customers' }, body: true },
  'customers update': { http: { method: 'PUT', path: '/v3/customers' }, body: true },
  'customers delete': { http: { method: 'DELETE', path: '/v3/customers?id:in={id}' } },

  'channels list': { http: { method: 'GET', path: '/v3/channels' } },
  'channels get': { http: { method: 'GET', path: '/v3/channels/{id}' } },

  'inventory list': { http: { method: 'GET', path: '/v3/inventory/items' } },
  'inventory update': { http: { method: 'PUT', path: '/v3/inventory/adjustments/absolute' } },
};

/** "catalog products list" for a command, without the program name. */
export function commandPath(cmd: Command): string {
  const parts: string[] = [];
  for (let c: Command | null = cmd; c && c.parent; c = c.parent) parts.unshift(c.name());
  return parts.join(' ');
}

export function isMutating(meta: CommandMeta | undefined): boolean | 'conditional' | undefined {
  if (!meta) return undefined;
  if (meta.mutating !== undefined) return meta.mutating;
  if (meta.http) return meta.http.method !== 'GET';
  return undefined;
}
