import { spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { AddressInfo } from 'net';

const CLI = path.resolve(__dirname, '../../dist/index.js');

export const STORE_HASH = 'testhash';
export const TOKEN = 'test-token-secret';

export interface MockRoute {
  method: string;
  /** Path after /stores/{hash}, e.g. "/v3/catalog/products". A RegExp matches the same string. */
  path: string | RegExp;
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Answer this many times, then fall through to the next matching route. */
  times?: number;
}

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/**
 * A local stand-in for api.bigcommerce.com. The CLI is pointed at it through
 * BIGC_API_URL, so every request a test makes is recorded and nothing can reach
 * a real store. Unmatched requests answer 599 so a missing mock is obvious.
 */
export class MockServer {
  requests: RecordedRequest[] = [];
  private routes: (MockRoute & { used: number })[] = [];
  private server = http.createServer((req, res) => this.handle(req, res));

  async start(): Promise<this> {
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));
    return this;
  }

  get url(): string {
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  on(...routes: MockRoute[]): this {
    this.routes.push(...routes.map(r => ({ ...r, used: 0 })));
    return this;
  }

  reset(): void {
    this.routes = [];
    this.requests = [];
  }

  close(): Promise<void> {
    return new Promise(resolve => this.server.close(() => resolve()));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const storePrefix = `/stores/${STORE_HASH}`;
      const p = url.pathname.startsWith(storePrefix) ? url.pathname.slice(storePrefix.length) : url.pathname;
      this.requests.push({
        method: req.method ?? 'GET',
        path: p,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf-8'),
      });

      const route = this.routes.find(r =>
        r.method === req.method &&
        (typeof r.path === 'string' ? r.path === p : r.path.test(p)) &&
        (r.times === undefined || r.used < r.times));
      if (!route) {
        res.writeHead(599, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ title: `no mock for ${req.method} ${p}` }));
        return;
      }
      route.used++;
      const status = route.status ?? 200;
      res.writeHead(status, { 'Content-Type': 'application/json', ...route.headers });
      res.end(status === 204 || route.body === undefined ? undefined : JSON.stringify(route.body));
    });
  }
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  json: () => any;
  errorJson: () => any;
}

export interface RunOptions {
  server?: MockServer;
  env?: Record<string, string | undefined>;
  /** Leave out BIGC_STORE_HASH/BIGC_TOKEN so the CLI has to find a profile. */
  noEnvCredentials?: boolean;
  configDir?: string;
  stdin?: string;
}

export function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bigc-test-'));
}

/**
 * Runs the built CLI as a subprocess. The environment is built from scratch,
 * never inherited, so a developer's real BIGC_* variables or ~/.bc-cli can't
 * leak into a test, and HOME points at a throwaway directory.
 */
export function runCli(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const home = tempDir();
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: home,
    BIGC_CONFIG_DIR: opts.configDir ?? path.join(home, '.bc-cli'),
    BIGC_API_URL: opts.server?.url ?? 'http://127.0.0.1:9',
  };
  if (!opts.noEnvCredentials) {
    env.BIGC_STORE_HASH = STORE_HASH;
    env.BIGC_TOKEN = TOKEN;
  }
  for (const [k, v] of Object.entries(opts.env ?? {})) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => (stdout += d));
    child.stderr.on('data', d => (stderr += d));
    child.on('error', reject);
    child.on('close', code => {
      fs.rmSync(home, { recursive: true, force: true });
      resolve({
        code: code ?? -1,
        stdout,
        stderr,
        json: () => JSON.parse(stdout),
        errorJson: () => JSON.parse(stderr),
      });
    });
    child.stdin.end(opts.stdin ?? '');
  });
}
