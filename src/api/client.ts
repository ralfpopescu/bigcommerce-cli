import * as fs from 'fs';
import * as path from 'path';
import fetch, { Response } from 'node-fetch';
import FormData from 'form-data';

const BASE = 'https://api.bigcommerce.com/stores';

export type MultipartField = string | number | boolean | { filePath: string };

export class ApiClient {
  constructor(private storeHash: string, private accessToken: string) {}

  private url(version: 'v2' | 'v3', resource: string): string {
    return `${BASE}/${this.storeHash}/${version}/${resource.replace(/^\//, '')}`;
  }

  // Store-rooted URL for a caller-supplied path such as "/v3/catalog/products".
  private storeUrl(pathname: string): string {
    return `${BASE}/${this.storeHash}/${pathname.replace(/^\//, '')}`;
  }

  private headers(): Record<string, string> {
    return {
      'X-Auth-Token': this.accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private async handleResponse(res: Response): Promise<unknown> {
    if (res.status === 204) return null;

    // Not every endpoint answers with JSON — 404s from the edge and a few
    // settings endpoints return HTML or plain text.
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
        return text;
      }
    }

    if (!res.ok) {
      const d = data as Record<string, unknown> | null;
      const msg =
        (d?.title as string) ??
        (Array.isArray(d?.errors) ? JSON.stringify(d.errors) : null) ??
        (d?.errors ? JSON.stringify(d.errors) : null) ??
        res.statusText;
      throw new Error(`${res.status}: ${msg}`);
    }
    return data;
  }

  private async send(method: string, url: string, body?: unknown, attempt = 0): Promise<unknown> {
    const res: Response = await fetch(url, {
      method,
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 429 && attempt < 3) {
      const wait = parseInt(res.headers.get('X-Rate-Limit-Time-Reset-Ms') ?? '5000', 10);
      await new Promise(r => setTimeout(r, wait));
      return this.send(method, url, body, attempt + 1);
    }

    return this.handleResponse(res);
  }

  private async sendMultipart(
    method: 'POST' | 'PUT',
    url: string,
    fields: Record<string, MultipartField | undefined>,
    attempt = 0,
  ): Promise<unknown> {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null) continue;
      if (typeof value === 'object' && 'filePath' in value) {
        form.append(key, fs.createReadStream(value.filePath), {
          filename: path.basename(value.filePath),
        });
      } else {
        form.append(key, String(value));
      }
    }

    const res: Response = await fetch(url, {
      method,
      headers: {
        'X-Auth-Token': this.accessToken,
        Accept: 'application/json',
        ...form.getHeaders(),
      },
      body: form,
    });

    if (res.status === 429 && attempt < 3) {
      const wait = parseInt(res.headers.get('X-Rate-Limit-Time-Reset-Ms') ?? '5000', 10);
      await new Promise(r => setTimeout(r, wait));
      return this.sendMultipart(method, url, fields, attempt + 1);
    }

    return this.handleResponse(res);
  }

  private buildUrl(version: 'v2' | 'v3', resource: string, params?: Record<string, unknown>): string {
    let url = this.url(version, resource);
    if (params) {
      const qs = new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== null)
          .reduce((acc, [k, v]) => ({ ...acc, [k]: String(v) }), {} as Record<string, string>)
      ).toString();
      if (qs) url += `?${qs}`;
    }
    return url;
  }

  get(version: 'v2' | 'v3', resource: string, params?: Record<string, unknown>): Promise<unknown> {
    return this.send('GET', this.buildUrl(version, resource, params));
  }

  post(version: 'v2' | 'v3', resource: string, body: unknown): Promise<unknown> {
    return this.send('POST', this.url(version, resource), body);
  }

  put(version: 'v2' | 'v3', resource: string, body: unknown): Promise<unknown> {
    return this.send('PUT', this.url(version, resource), body);
  }

  del(version: 'v2' | 'v3', resource: string, params?: Record<string, unknown>): Promise<unknown> {
    return this.send('DELETE', this.buildUrl(version, resource, params));
  }

  postMultipart(
    version: 'v2' | 'v3',
    resource: string,
    fields: Record<string, MultipartField | undefined>,
  ): Promise<unknown> {
    return this.sendMultipart('POST', this.url(version, resource), fields);
  }

  putMultipart(
    version: 'v2' | 'v3',
    resource: string,
    fields: Record<string, MultipartField | undefined>,
  ): Promise<unknown> {
    return this.sendMultipart('PUT', this.url(version, resource), fields);
  }

  // Raw request against any store path, e.g. request('GET', '/v3/sites').
  request(
    method: string,
    pathname: string,
    opts: { body?: unknown; params?: Record<string, unknown> } = {},
  ): Promise<unknown> {
    let url = this.storeUrl(pathname);
    if (opts.params) {
      const qs = new URLSearchParams(
        Object.entries(opts.params)
          .filter(([, v]) => v !== undefined && v !== null)
          .reduce((acc, [k, v]) => ({ ...acc, [k]: String(v) }), {} as Record<string, string>)
      ).toString();
      if (qs) url += `${url.includes('?') ? '&' : '?'}${qs}`;
    }
    return this.send(method, url, opts.body);
  }

  // The Admin GraphQL API lives at /graphql, outside the versioned REST tree.
  async graphql(query: string, variables?: Record<string, unknown>): Promise<unknown> {
    return this.send('POST', this.storeUrl('graphql'), { query, variables });
  }

  // Multipart upload against any store path, e.g. "v3/settings/logo/image".
  requestMultipart(
    method: 'POST' | 'PUT',
    pathname: string,
    fields: Record<string, MultipartField | undefined>,
  ): Promise<unknown> {
    return this.sendMultipart(method, this.storeUrl(pathname), fields);
  }

  // Streams a binary response (theme downloads, redirect exports) to disk.
  async download(pathname: string, destination: string): Promise<void> {
    const res: Response = await fetch(this.storeUrl(pathname), { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`${res.status}: ${res.statusText}`);
    }
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(destination);
      res.body.pipe(out);
      res.body.on('error', reject);
      out.on('finish', () => resolve());
    });
  }

  // Auto-paginate V3 endpoints ({ data: T[], meta: { pagination: {...} } })
  async getAllV3(resource: string, params?: Record<string, unknown>): Promise<unknown[]> {
    let page = 1;
    const all: unknown[] = [];
    while (true) {
      const res = await this.get('v3', resource, { ...params, page, limit: 250 }) as {
        data: unknown[];
        meta?: { pagination?: { current_page: number; total_pages: number } };
      };
      all.push(...(res.data ?? []));
      const pg = res.meta?.pagination;
      if (!pg || pg.current_page >= pg.total_pages) break;
      page++;
    }
    return all;
  }

  // Auto-paginate V2 endpoints (plain arrays, empty array = done)
  async getAllV2(resource: string, params?: Record<string, unknown>): Promise<unknown[]> {
    let page = 1;
    const all: unknown[] = [];
    while (true) {
      const res = await this.get('v2', resource, { ...params, page, limit: 250 }) as unknown[];
      if (!Array.isArray(res) || res.length === 0) break;
      all.push(...res);
      if (res.length < 250) break;
      page++;
    }
    return all;
  }
}
