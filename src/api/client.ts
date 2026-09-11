import FormData from 'form-data';
import * as fs from 'fs';
import nodeFetch, { RequestInit, Response } from 'node-fetch';
import * as path from 'path';

export const DEFAULT_BASE_URL = 'https://api.bigcommerce.com/stores';

const MAX_PAGE_SIZE = 250;
const DEFAULT_RETRY_WAIT_MS = 5000;
const DEFAULT_MAX_RETRIES = 3;
const RATE_LIMIT_RESET_HEADER = 'X-Rate-Limit-Time-Reset-Ms';

export type Version = 'v2' | 'v3';

export type MultipartField = string | number | boolean | { filePath: string };

/** Callers forward unset command options straight through, so null is expected. */
type MultipartInput = Record<string, MultipartField | null | undefined>;

/** The subset of `fetch` this client uses. Injectable so tests never hit the network. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  storeHash: string;
  accessToken: string;
  /** Override the API host. Primarily a test seam. */
  baseUrl?: string;
  /** Override the HTTP implementation. Primarily a test seam. */
  fetch?: FetchLike;
  /** Override the rate-limit backoff delay. Primarily a test seam. */
  sleep?: (ms: number) => Promise<void>;
  /** How many times to retry a 429 before giving up. Defaults to 3. */
  maxRetries?: number;
}

interface V3Envelope<T> {
  data?: T;
  meta?: { pagination?: { current_page: number; total_pages: number } };
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Renders a query-parameter value. Objects are JSON-encoded; the rest stringify. */
function scalarToString(value: unknown): string {
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  return '';
}

/** Serializes a query object, dropping unset values. */
function queryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }

    search.append(key, scalarToString(value));
  }

  return search.toString();
}

export class ApiClient {
  private readonly storeHash: string;
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly fetch: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;

  constructor(options: ApiClientOptions) {
    this.storeHash = options.storeHash;
    this.accessToken = options.accessToken;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetch = options.fetch ?? nodeFetch;
    this.sleep = options.sleep ?? realSleep;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async get<T = unknown>(
    version: Version,
    resource: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    return this.send<T>('GET', this.buildUrl(version, resource, params));
  }

  async post<T = unknown>(version: Version, resource: string, body: unknown): Promise<T> {
    return this.send<T>('POST', this.url(version, resource), body);
  }

  async put<T = unknown>(version: Version, resource: string, body: unknown): Promise<T> {
    return this.send<T>('PUT', this.url(version, resource), body);
  }

  async del<T = unknown>(
    version: Version,
    resource: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    return this.send<T>('DELETE', this.buildUrl(version, resource, params));
  }

  async postMultipart<T = unknown>(
    version: Version,
    resource: string,
    fields: MultipartInput,
  ): Promise<T> {
    return this.sendMultipart<T>('POST', this.url(version, resource), fields);
  }

  async putMultipart<T = unknown>(
    version: Version,
    resource: string,
    fields: MultipartInput,
  ): Promise<T> {
    return this.sendMultipart<T>('PUT', this.url(version, resource), fields);
  }

  /** Raw request against any store path, e.g. request('GET', '/v3/sites'). */
  async request<T = unknown>(
    method: string,
    pathname: string,
    opts: { body?: unknown; params?: Record<string, unknown> } = {},
  ): Promise<T> {
    let url = this.storeUrl(pathname);

    if (opts.params) {
      const qs = queryString(opts.params);

      if (qs) {
        url += `${url.includes('?') ? '&' : '?'}${qs}`;
      }
    }

    return this.send<T>(method, url, opts.body);
  }

  /** The Admin GraphQL API lives at /graphql, outside the versioned REST tree. */
  async graphql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
    return this.send<T>('POST', this.storeUrl('graphql'), { query, variables });
  }

  /** Multipart upload against any store path, e.g. "v3/settings/logo/image". */
  async requestMultipart<T = unknown>(
    method: 'POST' | 'PUT',
    pathname: string,
    fields: MultipartInput,
  ): Promise<T> {
    return this.sendMultipart<T>(method, this.storeUrl(pathname), fields);
  }

  /** Streams a binary response (theme downloads, redirect exports) to disk. */
  async download(pathname: string, destination: string): Promise<void> {
    const res = await this.fetch(this.storeUrl(pathname), { headers: this.headers() });

    if (!res.ok) {
      throw new Error(`${res.status}: ${res.statusText}`);
    }

    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(destination);

      res.body.pipe(out);
      res.body.on('error', reject);
      out.on('finish', () => {
        resolve();
      });
    });
  }

  /** Auto-paginate V3 endpoints ({ data: T[], meta: { pagination } }). */
  async getAllV3(resource: string, params?: Record<string, unknown>): Promise<unknown[]> {
    const all: unknown[] = [];
    let page = 1;
    let more = true;

    while (more) {
      const res = await this.get<V3Envelope<unknown[]>>('v3', resource, {
        ...params,
        page,
        limit: MAX_PAGE_SIZE,
      });

      all.push(...(res.data ?? []));

      const pagination = res.meta?.pagination;

      more = Boolean(pagination && pagination.current_page < pagination.total_pages);
      page += 1;
    }

    return all;
  }

  /** Auto-paginate V2 endpoints (plain arrays, empty array = done). */
  async getAllV2(resource: string, params?: Record<string, unknown>): Promise<unknown[]> {
    const all: unknown[] = [];
    let page = 1;
    let more = true;

    while (more) {
      const res = await this.get<unknown[] | null>('v2', resource, {
        ...params,
        page,
        limit: MAX_PAGE_SIZE,
      });

      if (!Array.isArray(res) || res.length === 0) {
        break;
      }

      all.push(...res);
      more = res.length === MAX_PAGE_SIZE;
      page += 1;
    }

    return all;
  }

  private url(version: Version, resource: string): string {
    return `${this.baseUrl}/${this.storeHash}/${version}/${resource.replace(/^\//, '')}`;
  }

  /** Store-rooted URL for a caller-supplied path such as "/v3/catalog/products". */
  private storeUrl(pathname: string): string {
    return `${this.baseUrl}/${this.storeHash}/${pathname.replace(/^\//, '')}`;
  }

  private buildUrl(version: Version, resource: string, params?: Record<string, unknown>): string {
    const url = this.url(version, resource);
    const qs = params ? queryString(params) : '';

    return qs ? `${url}?${qs}` : url;
  }

  private headers(): Record<string, string> {
    return {
      'X-Auth-Token': this.accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private async send<T>(method: string, url: string, body?: unknown, attempt = 0): Promise<T> {
    const res = await this.fetch(url, {
      method,
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (this.shouldRetry(res, attempt)) {
      await this.sleep(retryWait(res));

      return this.send<T>(method, url, body, attempt + 1);
    }

    return this.handleResponse<T>(res);
  }

  private async sendMultipart<T>(
    method: 'POST' | 'PUT',
    url: string,
    fields: MultipartInput,
    attempt = 0,
  ): Promise<T> {
    const form = buildForm(fields);
    const res = await this.fetch(url, {
      method,
      headers: {
        'X-Auth-Token': this.accessToken,
        Accept: 'application/json',
        ...form.getHeaders(),
      },
      body: form,
    });

    if (this.shouldRetry(res, attempt)) {
      await this.sleep(retryWait(res));

      return this.sendMultipart<T>(method, url, fields, attempt + 1);
    }

    return this.handleResponse<T>(res);
  }

  private shouldRetry(res: Response, attempt: number): boolean {
    return res.status === 429 && attempt < this.maxRetries;
  }

  private async handleResponse<T>(res: Response): Promise<T> {
    if (res.status === 204) {
      return null as T;
    }

    // Not every endpoint answers with JSON — 404s from the edge and a few
    // settings endpoints return HTML or plain text.
    const text = await res.text();
    let data: unknown = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        if (!res.ok) {
          throw new Error(`${res.status}: ${res.statusText}`);
        }

        return text as T;
      }
    }

    if (!res.ok) {
      throw new Error(`${res.status}: ${errorMessage(data, res.statusText)}`);
    }

    // The single unchecked boundary in the client: the API's response shape is
    // asserted by the caller, which knows the endpoint it asked for.
    return data as T;
  }
}

function buildForm(fields: MultipartInput): FormData {
  const form = new FormData();

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === 'object' && 'filePath' in value) {
      form.append(key, fs.createReadStream(value.filePath), {
        filename: path.basename(value.filePath),
      });
    } else {
      form.append(key, String(value));
    }
  }

  return form;
}

function retryWait(res: Response): number {
  const header = res.headers.get(RATE_LIMIT_RESET_HEADER);
  const parsed = header === null ? NaN : parseInt(header, 10);

  return Number.isNaN(parsed) ? DEFAULT_RETRY_WAIT_MS : parsed;
}

/** Pulls the most specific message the API offered out of an error body. */
function errorMessage(data: unknown, fallback: string): string {
  if (data === null || typeof data !== 'object') {
    return fallback;
  }

  const body: Record<string, unknown> = data as Record<string, unknown>;

  if (typeof body.title === 'string') {
    return body.title;
  }

  if (body.errors !== undefined && body.errors !== null) {
    return JSON.stringify(body.errors);
  }

  return fallback;
}
