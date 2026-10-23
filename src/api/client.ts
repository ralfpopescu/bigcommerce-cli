import * as fs from 'fs';
import * as path from 'path';
import fetch, { Response } from 'node-fetch';
import FormData from 'form-data';
import { parse, Kind } from 'graphql';
import { ApiError, CliError, EXIT, GraphQLError, UsageError } from '../errors';
import { envReadOnly } from '../config';
import { runtime } from '../runtime';

// BIGC_API_URL exists for the test suite, which points the CLI at a local mock
// server. Nothing else should need it.
const BASE = `${process.env.BIGC_API_URL || 'https://api.bigcommerce.com'}/stores`;

const MAX_RETRIES = 3;

export type MultipartField = string | number | boolean | { filePath: string };

/** What a write would have sent. Printed by --dry-run instead of sending it. */
export interface PlannedRequest {
  method: string;
  url: string;
  query?: Record<string, string>;
  body?: unknown;
  /** Multipart uploads list field names and file paths, never the bytes. */
  multipart?: Record<string, string | { file: string }>;
}

/**
 * Thrown in place of a write under --dry-run. It unwinds whatever command was
 * running, and the top-level handler prints the request it carries. Throwing
 * (rather than returning a fake response) means no command can carry on as if
 * the write had happened.
 */
export class DryRunStop extends Error {
  constructor(readonly request: PlannedRequest) {
    super('dry run');
  }
}

export interface ExternalRequest {
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  /** Defaults to "anything but GET". GraphQL POSTs pass false for queries. */
  mutating?: boolean;
}

/** True when a GraphQL document contains a mutation. Throws a usage error if it doesn't parse. */
export function isGraphQLMutation(query: string): boolean {
  let doc;
  try {
    doc = parse(query);
  } catch (e) {
    throw new UsageError(`The GraphQL document doesn't parse: ${(e as Error).message}`);
  }
  return doc.definitions.some(d => d.kind === Kind.OPERATION_DEFINITION && d.operation === 'mutation');
}

function splitUrl(url: string): { base: string; query?: Record<string, string> } {
  const u = new URL(url);
  const query = Object.fromEntries(u.searchParams.entries());
  return { base: `${u.origin}${u.pathname}`, query: Object.keys(query).length ? query : undefined };
}

function toQuery(params?: Record<string, unknown>): string {
  if (!params) return '';
  return new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null)
      .reduce((acc, [k, v]) => ({ ...acc, [k]: String(v) }), {} as Record<string, string>)
  ).toString();
}

export class ApiClient {
  private readOnly: boolean;

  constructor(private storeHash: string, private accessToken: string, opts: { readOnly?: boolean } = {}) {
    this.readOnly = Boolean(opts.readOnly) || envReadOnly();
  }

  get store(): string {
    return this.storeHash;
  }

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

  /** The path an error reports: store-relative for the REST host, otherwise the bare URL. */
  private displayPath(url: string): string {
    const { base } = splitUrl(url);
    const prefix = `${BASE}/${this.storeHash}`;
    return base.startsWith(prefix) ? base.slice(prefix.length) || '/' : base;
  }

  /**
   * The write guards. Every request goes through here before the network, so
   * neither --dry-run nor read-only mode depends on each command remembering
   * to check. Dry-run wins over read-only: it sends nothing either way, and
   * previewing a write is exactly what a read-only session may want.
   */
  private guard(method: string, url: string, planned: Omit<PlannedRequest, 'method' | 'url' | 'query'>, mutating?: boolean): void {
    const writes = mutating ?? method.toUpperCase() !== 'GET';
    if (!writes) return;
    if (runtime.dryRun) {
      const { base, query } = splitUrl(url);
      throw new DryRunStop({ method, url: base, ...(query ? { query } : {}), ...planned });
    }
    if (this.readOnly) {
      throw new CliError(
        `Read-only mode: refusing ${method} ${this.displayPath(url)}. ` +
          'Unset BIGC_READ_ONLY or run `bigc auth set <profile> --read-only false` to allow writes.',
        EXIT.blocked,
      );
    }
  }

  private async handleResponse(res: Response, method: string, url: string): Promise<unknown> {
    if (res.status === 204) return null;

    // Not every endpoint answers with JSON — 404s from the edge and a few
    // settings endpoints return HTML or plain text.
    const text = await res.text();
    let data: unknown = null;
    let parsed = true;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        parsed = false;
      }
    }

    if (!res.ok) throw this.apiError(res, method, url, parsed ? data : null);
    return parsed ? data : text;
  }

  /**
   * Keeps both halves of a BigCommerce error: the generic `title` and the
   * field-level `errors`, which is what a caller needs to fix the request.
   * V2 has no title and sends an array of { status, message } instead.
   */
  private apiError(res: Response, method: string, url: string, data: unknown): ApiError {
    const d = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
    const errors = Array.isArray(data) ? data : d?.errors;
    let title = typeof d?.title === 'string' ? d.title : undefined;
    if (!title && Array.isArray(errors)) {
      title = errors
        .map(e => (e && typeof e === 'object' ? (e as Record<string, unknown>).message : e))
        .filter(Boolean)
        .join('; ');
    }
    if (!title && typeof d?.message === 'string') title = d.message;

    const reset = res.headers.get('X-Rate-Limit-Time-Reset-Ms');
    const requestId = res.headers.get('X-Request-Id') ?? res.headers.get('X-Correlation-Id') ?? undefined;
    return new ApiError({
      status: res.status,
      title: title || res.statusText || `HTTP ${res.status}`,
      ...(errors !== undefined && errors !== null && (typeof errors !== 'object' || Object.keys(errors).length) ? { errors } : {}),
      method,
      path: this.displayPath(url),
      ...(requestId ? { requestId } : {}),
      ...(res.status === 429 && reset ? { retryAfterMs: parseInt(reset, 10) } : {}),
    });
  }

  /** fetch with the 429 retry loop, honouring X-Rate-Limit-Time-Reset-Ms. */
  private async fetchRetrying(url: string, init: () => Parameters<typeof fetch>[1]): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, init());
      if (res.status !== 429 || attempt >= MAX_RETRIES) return res;
      const wait = parseInt(res.headers.get('X-Rate-Limit-Time-Reset-Ms') ?? '5000', 10);
      await new Promise(r => setTimeout(r, wait));
    }
  }

  private async send(method: string, url: string, body?: unknown, mutating?: boolean): Promise<unknown> {
    this.guard(method, url, body !== undefined ? { body } : {}, mutating);
    const res = await this.fetchRetrying(url, () => ({
      method,
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }));
    return this.handleResponse(res, method, url);
  }

  private async sendMultipart(
    method: 'POST' | 'PUT',
    url: string,
    fields: Record<string, MultipartField | undefined>,
  ): Promise<unknown> {
    const planned: Record<string, string | { file: string }> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null) continue;
      planned[key] = typeof value === 'object' ? { file: value.filePath } : String(value);
    }
    this.guard(method, url, { multipart: planned });

    // A stream can only be read once, so each attempt builds a fresh form.
    const build = () => {
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
      return form;
    };

    const res = await this.fetchRetrying(url, () => {
      const form = build();
      return {
        method,
        headers: {
          'X-Auth-Token': this.accessToken,
          Accept: 'application/json',
          ...form.getHeaders(),
        },
        body: form,
      };
    });
    return this.handleResponse(res, method, url);
  }

  private buildUrl(version: 'v2' | 'v3', resource: string, params?: Record<string, unknown>): string {
    const url = this.url(version, resource);
    const qs = toQuery(params);
    return qs ? `${url}?${qs}` : url;
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
    opts: { body?: unknown; params?: Record<string, unknown>; mutating?: boolean } = {},
  ): Promise<unknown> {
    let url = this.storeUrl(pathname);
    const qs = toQuery(opts.params);
    if (qs) url += `${url.includes('?') ? '&' : '?'}${qs}`;
    return this.send(method, url, opts.body, opts.mutating);
  }

  /**
   * The Admin GraphQL API lives at /graphql, outside the versioned REST tree.
   * Every operation is a POST, so whether it writes is read from the document.
   */
  async graphql(query: string, variables?: Record<string, unknown>): Promise<unknown> {
    const mutating = isGraphQLMutation(query);
    const url = this.storeUrl('graphql');
    const res = await this.send('POST', url, { query, variables }, mutating);
    return graphqlData(res, '/graphql');
  }

  /**
   * A request to a host other than the REST API — the storefront's /graphql or
   * payments.bigcommerce.com. The store's X-Auth-Token is never sent there;
   * the caller supplies whatever auth that host takes. The write guards and
   * error handling are the same as for any other request.
   */
  async external(url: string, req: ExternalRequest): Promise<unknown> {
    this.guard(req.method, url, req.body !== undefined ? { body: req.body } : {}, req.mutating);
    const res = await this.fetchRetrying(url, () => ({
      method: req.method,
      headers: req.headers,
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
    }));
    return this.handleResponse(res, req.method, url);
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
    const url = this.storeUrl(pathname);
    const res: Response = await this.fetchRetrying(url, () => ({ headers: this.headers() }));
    if (!res.ok) {
      const text = await res.text();
      let data: unknown = null;
      try {
        data = JSON.parse(text);
      } catch {
        // not JSON; the status line is all there is
      }
      throw this.apiError(res, 'GET', url, data);
    }
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(destination);
      res.body.pipe(out);
      res.body.on('error', reject);
      out.on('finish', () => resolve());
    });
  }

  /** Yields each page of a V3 collection ({ data: T[], meta: { pagination } }). */
  async *pagesV3(resource: string, params?: Record<string, unknown>): AsyncGenerator<unknown[]> {
    for (let page = 1; ; page++) {
      const res = await this.get('v3', resource, { ...params, page, limit: 250 }) as {
        data: unknown[];
        meta?: { pagination?: { current_page: number; total_pages: number } };
      } | null;
      yield res?.data ?? [];
      const pg = res?.meta?.pagination;
      if (!pg || pg.current_page >= pg.total_pages) return;
    }
  }

  /** Yields each page of a V2 collection (plain arrays; empty or short page = done). */
  async *pagesV2(resource: string, params?: Record<string, unknown>): AsyncGenerator<unknown[]> {
    for (let page = 1; ; page++) {
      const res = await this.get('v2', resource, { ...params, page, limit: 250 });
      if (!Array.isArray(res) || res.length === 0) return;
      yield res;
      if (res.length < 250) return;
    }
  }

  // Auto-paginate V3 endpoints ({ data: T[], meta: { pagination: {...} } })
  async getAllV3(resource: string, params?: Record<string, unknown>): Promise<unknown[]> {
    const all: unknown[] = [];
    for await (const page of this.pagesV3(resource, params)) all.push(...page);
    return all;
  }

  // Auto-paginate V2 endpoints (plain arrays, empty array = done)
  async getAllV2(resource: string, params?: Record<string, unknown>): Promise<unknown[]> {
    const all: unknown[] = [];
    for await (const page of this.pagesV2(resource, params)) all.push(...page);
    return all;
  }
}

/** Unwraps a GraphQL response, turning a non-empty `errors` array into a GraphQLError. */
export function graphqlData(res: unknown, endpoint: string): unknown {
  const r = (res ?? {}) as { data?: unknown; errors?: { message: string; path?: unknown; extensions?: unknown }[] };
  if (Array.isArray(r.errors) && r.errors.length) throw new GraphQLError(r.errors, endpoint);
  return r.data;
}
