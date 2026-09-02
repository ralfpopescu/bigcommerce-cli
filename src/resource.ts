import * as fs from 'fs';
import { Command } from 'commander';
import ora from 'ora';
import { getProfile } from './config';
import { ApiClient } from './api/client';
import { print, success, errorOut, OutputFormat } from './output';

export type Version = 'v2' | 'v3';
export type Op = 'list' | 'get' | 'create' | 'update' | 'delete' | 'delete-many';

/**
 * How a resource is addressed and shaped:
 *   v3-item      GET/POST /res, GET/PUT/DELETE /res/{id}, responses wrapped in { data }
 *   v3-batch     GET /res, POST/PUT /res with arrays, DELETE /res?id:in=
 *   v3-singleton GET/PUT /res — one object per store, no ID
 *   v2-item      same as v3-item but V2 returns bare JSON
 *   v2-singleton GET/PUT /res, bare JSON
 */
export type Style = 'v3-item' | 'v3-batch' | 'v3-singleton' | 'v2-item' | 'v2-singleton';

export interface ActionSpec {
  name: string;
  describe: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Store-rooted path with {placeholders}, e.g. "v3/themes/{uuid}/actions/download". */
  path: string;
  /** Placeholder names taken as positional arguments instead of options. */
  args?: string[];
  /** Accept --data/--file and send it as the request body. */
  body?: boolean;
  /** Query-string parameters exposed as options. */
  params?: string[];
  /** Unwrap a { data } envelope before printing. Defaults to true for V3 paths. */
  envelope?: boolean;
  fields?: string[];
  done?: string;
  /** Multipart upload: --file is sent as `field`, --url (if `urlField`) as JSON. */
  upload?: { field: string; urlField?: string };
  /** Streams the response to --out instead of printing it. */
  download?: boolean;
}

export interface ResourceSpec {
  name: string;
  describe: string;
  /** Versionless path with {placeholders}, e.g. "catalog/products/{product_id}/images". */
  path?: string;
  style?: Style;
  ops?: Op[];
  fields?: string[];
  /** Query-string filters exposed as options on `list`. */
  params?: string[];
  idLabel?: string;
  /** Filter key used to delete from a v3-batch resource. */
  deleteQuery?: string;
  /** Set false for endpoints that ignore page/limit. */
  paginate?: boolean;
  children?: ResourceSpec[];
  actions?: ActionSpec[];
}

// ── Shared plumbing ─────────────────────────────────────────────────────────

function client(profile?: string): ApiClient {
  const p = getProfile(profile);
  return new ApiClient(p.storeHash, p.accessToken);
}

function parseInput(opts: { data?: string; file?: string }): unknown {
  if (opts.data) return JSON.parse(opts.data);
  if (opts.file) return JSON.parse(fs.readFileSync(opts.file, 'utf-8'));
  throw new Error('Provide --data <json> or --file <path>');
}

function optionName(placeholder: string): string {
  return `--${placeholder.replace(/_/g, '-')}`;
}

function propName(placeholder: string): string {
  return placeholder.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function label(placeholder: string): string {
  return placeholder.replace(/_/g, ' ');
}

function placeholders(path: string): string[] {
  return Array.from(path.matchAll(/\{([a-z_]+)\}/g)).map(m => m[1]);
}

function fill(path: string, values: Record<string, unknown>): string {
  return path.replace(/\{([a-z_]+)\}/g, (_, key: string) => {
    const value = values[propName(key)];
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing ${optionName(key)}`);
    }
    return encodeURIComponent(String(value));
  });
}

type BaseOpts = { output: OutputFormat; profile?: string } & Record<string, unknown>;

function addOpts(cmd: Command): Command {
  return cmd
    .option('-o, --output <format>', 'output format: json|table|pretty', 'pretty')
    .option('--profile <name>', 'credential profile');
}

/** Adds a required option for every {placeholder} the path needs. */
function addPathOpts(cmd: Command, path: string, skip: string[] = []): Command {
  for (const p of placeholders(path)) {
    if (skip.includes(p)) continue;
    cmd.requiredOption(`${optionName(p)} <value>`, `${label(p)}`);
  }
  return cmd;
}

function addParamOpts(cmd: Command, params: string[] = []): Command {
  for (const p of params) {
    cmd.option(`${optionName(p)} <value>`, `filter by ${label(p)}`);
  }
  return cmd;
}

function collectParams(params: string[] = [], opts: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of params) {
    const value = opts[propName(p)];
    if (value !== undefined) out[p] = value;
  }
  return out;
}

function versionOf(style: Style): Version {
  return style.startsWith('v2') ? 'v2' : 'v3';
}

function isEnveloped(style: Style): boolean {
  return versionOf(style) === 'v3';
}

function defaultOps(style: Style): Op[] {
  if (style === 'v3-singleton' || style === 'v2-singleton') return ['get', 'update'];
  return ['list', 'get', 'create', 'update', 'delete'];
}

/** Runs an action, stopping the spinner exactly once whichever way it ends. */
async function run<T>(message: string, fn: () => Promise<T>, onDone: (value: T) => void): Promise<void> {
  const spinner = ora(message).start();
  try {
    const value = await fn();
    spinner.stop();
    onDone(value);
  } catch (e) {
    spinner.stop();
    errorOut((e as Error).message);
  }
}

// ── Operation builders ──────────────────────────────────────────────────────

function registerList(parent: Command, spec: ResourceSpec): void {
  const style = spec.style as Style;
  const version = versionOf(style);
  const path = spec.path as string;
  const paginated = spec.paginate !== false;

  const cmd = parent.command('list').description(`List ${spec.describe.toLowerCase()}`);
  addPathOpts(cmd, path);
  addParamOpts(cmd, spec.params);
  if (paginated) {
    cmd
      .option('--page <n>', 'page number')
      .option('--limit <n>', 'results per page (max 250)')
      .option('--all', 'fetch all pages');
  }
  cmd.option('--query <k=v>', 'extra query parameter (repeatable)', collectPairs, {} as Record<string, string>);

  addOpts(cmd).action(async (opts: BaseOpts & { page?: string; limit?: string; all?: boolean; query: Record<string, string> }) => {
    await run(`Fetching ${spec.name}...`, async () => {
      const bc = client(opts.profile);
      const resource = fill(path, opts);
      const params = { ...collectParams(spec.params, opts), ...opts.query };

      if (paginated && opts.all) {
        return version === 'v3' ? bc.getAllV3(resource, params) : bc.getAllV2(resource, params);
      }
      if (paginated) {
        if (opts.page) params.page = opts.page;
        if (opts.limit) params.limit = opts.limit;
      }
      const res = await bc.get(version, resource, params);
      const data = isEnveloped(style) ? (res as { data: unknown }).data : res;
      // V2 answers 204 with no body for an empty collection.
      return data ?? [];
    }, data => print(data, opts.output, spec.fields));
  });
}

function registerGet(parent: Command, spec: ResourceSpec): void {
  const style = spec.style as Style;
  const version = versionOf(style);
  const path = spec.path as string;
  const singleton = style.endsWith('singleton');

  const cmd = parent.command('get').description(`Get ${singleton ? spec.describe.toLowerCase() : `a ${spec.idLabel ?? spec.name} by ID`}`);
  if (!singleton) cmd.argument('<id>', `${spec.idLabel ?? spec.name} ID`);
  addPathOpts(cmd, path);
  addParamOpts(cmd, spec.params);

  addOpts(cmd).action(async (...argv: unknown[]) => {
    const opts = argv[singleton ? 0 : 1] as BaseOpts;
    const id = singleton ? undefined : (argv[0] as string);
    await run(`Fetching ${spec.name}...`, async () => {
      const bc = client(opts.profile);
      const resource = fill(path, opts);
      const params = collectParams(spec.params, opts);

      if (style === 'v3-batch') {
        const res = await bc.get(version, resource, { ...params, [spec.deleteQuery ?? 'id:in']: id }) as { data: unknown[] };
        const found = (res.data ?? [])[0];
        if (!found) throw new Error(`${spec.name} ${id} not found`);
        return found;
      }
      const res = await bc.get(version, singleton ? resource : `${resource}/${id}`, params);
      return isEnveloped(style) ? (res as { data: unknown }).data : res;
    }, data => print(data, opts.output, undefined));
  });
}

function registerCreate(parent: Command, spec: ResourceSpec): void {
  const style = spec.style as Style;
  const version = versionOf(style);
  const path = spec.path as string;

  const cmd = parent
    .command('create')
    .description(`Create ${spec.idLabel ?? spec.name}`)
    .option('--data <json>', 'request body as JSON')
    .option('--file <path>', 'path to a JSON file');
  addPathOpts(cmd, path);
  addParamOpts(cmd, spec.params);

  addOpts(cmd).action(async (opts: BaseOpts & { data?: string; file?: string }) => {
    await run(`Creating ${spec.name}...`, async () => {
      const bc = client(opts.profile);
      const resource = fill(path, opts);
      const input = parseInput(opts);
      const body = style === 'v3-batch' && !Array.isArray(input) ? [input] : input;
      const res = await bc.request('POST', `${version}/${resource}`, {
        body,
        params: collectParams(spec.params, opts),
      });
      return isEnveloped(style) ? (res as { data: unknown }).data : res;
    }, data => {
      success(`Created ${Array.isArray(data) ? `${data.length} ${spec.name}` : spec.idLabel ?? spec.name}`);
      print(data, opts.output, spec.fields);
    });
  });
}

function registerUpdate(parent: Command, spec: ResourceSpec): void {
  const style = spec.style as Style;
  const version = versionOf(style);
  const path = spec.path as string;
  const singleton = style.endsWith('singleton');
  const batch = style === 'v3-batch';

  const cmd = parent.command('update').description(`Update ${singleton ? spec.describe.toLowerCase() : spec.idLabel ?? spec.name}`);
  if (batch) cmd.argument('[id]', `${spec.idLabel ?? spec.name} ID (omit when --data is an array)`);
  else if (!singleton) cmd.argument('<id>', `${spec.idLabel ?? spec.name} ID`);
  cmd.option('--data <json>', 'fields to update as JSON').option('--file <path>', 'path to a JSON file');
  addPathOpts(cmd, path);
  addParamOpts(cmd, spec.params);

  addOpts(cmd).action(async (...argv: unknown[]) => {
    const opts = argv[singleton ? 0 : 1] as BaseOpts & { data?: string; file?: string };
    const id = singleton ? undefined : (argv[0] as string | undefined);
    await run(`Updating ${spec.name}...`, async () => {
      const bc = client(opts.profile);
      const resource = fill(path, opts);
      const input = parseInput(opts);

      const params = collectParams(spec.params, opts);

      if (batch) {
        if (!id && !Array.isArray(input)) {
          throw new Error(`Provide an ID, or pass an array of objects that each carry an "id"`);
        }
        const body = id ? [{ ...(input as Record<string, unknown>), id: numeric(id) }] : input;
        const res = await bc.request('PUT', `${version}/${resource}`, { body, params }) as { data: unknown[] };
        return id ? (res.data ?? [])[0] : res.data;
      }
      const target = singleton ? resource : `${resource}/${id}`;
      const res = await bc.request('PUT', `${version}/${target}`, { body: input, params });
      return isEnveloped(style) ? (res as { data: unknown }).data : res;
    }, data => {
      success(singleton ? `${spec.describe} updated` : `${spec.idLabel ?? spec.name} ${id ?? ''} updated`.trim());
      print(data, opts.output, spec.fields);
    });
  });
}

function registerDelete(parent: Command, spec: ResourceSpec): void {
  const style = spec.style as Style;
  const version = versionOf(style);
  const path = spec.path as string;

  const cmd = parent
    .command('delete')
    .description(`Delete ${spec.idLabel ?? spec.name}`)
    .argument('<id>', `${spec.idLabel ?? spec.name} ID (comma-separated for batch resources)`);
  addPathOpts(cmd, path);

  addOpts(cmd).action(async (id: string, opts: BaseOpts) => {
    await run(`Deleting ${spec.name}...`, async () => {
      const bc = client(opts.profile);
      const resource = fill(path, opts);
      if (style === 'v3-batch') {
        return bc.del(version, resource, { [spec.deleteQuery ?? 'id:in']: id });
      }
      return bc.del(version, `${resource}/${id}`);
    }, () => success(`${spec.idLabel ?? spec.name} ${id} deleted`));
  });
}

/**
 * Collection-level DELETE. These endpoints wipe every row when called bare, so
 * an unfiltered call has to be confirmed explicitly.
 */
function registerDeleteMany(parent: Command, spec: ResourceSpec): void {
  const style = spec.style as Style;
  const version = versionOf(style);
  const path = spec.path as string;

  const cmd = parent
    .command('delete-many')
    .description(`Delete ${spec.describe.toLowerCase()} in bulk`)
    .option('--query <k=v>', 'filter to delete by (repeatable)', collectPairs, {} as Record<string, string>)
    .option('--yes', 'confirm deleting every record when no filter is given');
  addPathOpts(cmd, path);
  addParamOpts(cmd, spec.params);

  addOpts(cmd).action(async (opts: BaseOpts & { query: Record<string, string>; yes?: boolean }) => {
    const params = { ...collectParams(spec.params, opts), ...opts.query };
    if (Object.keys(params).length === 0 && !opts.yes) {
      errorOut(`This deletes every ${spec.idLabel ?? spec.name} in the store. Narrow it with --query <k=v>, or pass --yes.`);
      return;
    }
    await run(`Deleting ${spec.name}...`, async () => {
      const bc = client(opts.profile);
      return bc.del(version, fill(path, opts), params);
    }, () => success(`Deleted ${spec.name} matching ${JSON.stringify(params)}`));
  });
}

function registerAction(parent: Command, spec: ResourceSpec, action: ActionSpec): void {
  const args = action.args ?? [];
  const cmd = parent.command(action.name).description(action.describe);
  for (const a of args) cmd.argument(`<${a.replace(/_/g, '-')}>`, label(a));
  addPathOpts(cmd, action.path, args);
  addParamOpts(cmd, action.params);
  if (action.body) {
    cmd.option('--data <json>', 'request body as JSON').option('--file <path>', 'path to a JSON file');
  }
  if (action.upload) {
    cmd.option('--file <path>', 'local image file to upload');
    if (action.upload.urlField) cmd.option('--url <url>', 'publicly reachable image URL');
  }
  if (action.download) {
    cmd.requiredOption('--out <path>', 'file to write the response to');
  }

  addOpts(cmd).action(async (...argv: unknown[]) => {
    const opts = argv[args.length] as BaseOpts & { data?: string; file?: string };
    const positional: Record<string, unknown> = {};
    args.forEach((name, i) => {
      positional[propName(name)] = argv[i];
    });

    await run(`${action.name}...`, async () => {
      const bc = client(opts.profile);
      const pathname = fill(action.path, { ...opts, ...positional });
      const params = collectParams(action.params, opts);

      if (action.download) {
        const out = (opts as unknown as { out: string }).out;
        await bc.download(pathname, out);
        return { file: out };
      }

      if (action.upload) {
        const { field, urlField } = action.upload;
        const file = (opts as unknown as { file?: string }).file;
        const url = (opts as unknown as { url?: string }).url;
        if (file) {
          return bc.requestMultipart(action.method === 'PUT' ? 'PUT' : 'POST', pathname, {
            [field]: { filePath: file },
          });
        }
        if (url && urlField) {
          return bc.request(action.method, pathname, { body: { [urlField]: url }, params });
        }
        throw new Error(urlField ? 'Provide --file <path> or --url <url>' : 'Provide --file <path>');
      }

      const body = action.body ? parseInput(opts) : undefined;
      const res = await bc.request(action.method, pathname, { body, params });
      const enveloped = action.envelope ?? action.path.startsWith('v3/');
      return enveloped && res && typeof res === 'object' && 'data' in res
        ? (res as { data: unknown }).data
        : res;
    }, data => {
      if (action.done) success(action.done);
      if (data !== null && data !== undefined) print(data, opts.output, action.fields);
    });
  });
}

function collectPairs(value: string, previous: Record<string, string>): Record<string, string> {
  const index = value.indexOf('=');
  if (index === -1) throw new Error(`--query expects key=value, got "${value}"`);
  return { ...previous, [value.slice(0, index)]: value.slice(index + 1) };
}

function numeric(id: string): string | number {
  return /^\d+$/.test(id) ? parseInt(id, 10) : id;
}

// ── Mounting ────────────────────────────────────────────────────────────────

const BUILDERS: Record<Op, (parent: Command, spec: ResourceSpec) => void> = {
  list: registerList,
  get: registerGet,
  create: registerCreate,
  update: registerUpdate,
  delete: registerDelete,
  'delete-many': registerDeleteMany,
};

/**
 * Attaches a resource tree to `parent`. A subcommand that already exists — a
 * hand-written one, with behaviour the generic builders can't express — is kept
 * and only extended with the operations and children it doesn't already have.
 */
export function mount(parent: Command, spec: ResourceSpec): Command {
  const existing = parent.commands.find(c => c.name() === spec.name);
  const cmd = existing ?? parent.command(spec.name).description(spec.describe);

  if (spec.path && spec.style) {
    for (const op of spec.ops ?? defaultOps(spec.style)) {
      if (cmd.commands.some(c => c.name() === op)) continue;
      BUILDERS[op](cmd, spec);
    }
  }

  for (const action of spec.actions ?? []) {
    if (cmd.commands.some(c => c.name() === action.name)) continue;
    registerAction(cmd, spec, action);
  }

  for (const child of spec.children ?? []) mount(cmd, child);

  return cmd;
}

/**
 * Gives a hand-written list command the same filters a generated one gets: a
 * named option per declared query parameter, plus the repeatable `--query k=v`.
 */
export function queryOption(cmd: Command, params: string[] = []): Command {
  addParamOpts(cmd, params);
  return cmd.option('--query <k=v>', 'extra query parameter (repeatable)', collectPairs, {} as Record<string, string>);
}

/** The counterpart to `queryOption`: reads those options back into a query object. */
export function queryParams(opts: Record<string, unknown>, params: string[] = []): Record<string, unknown> {
  return { ...collectParams(params, opts), ...((opts.query as Record<string, string>) ?? {}) };
}

export function mountAll(program: Command, specs: ResourceSpec[]): void {
  for (const spec of specs) mount(program, spec);
}
