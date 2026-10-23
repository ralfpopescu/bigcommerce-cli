import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';
import { runtime } from './runtime';
import { ApiError, GraphQLError, UsageError, errorJson, exitCodeOf, fieldErrorLines } from './errors';
import { DryRunStop, PlannedRequest } from './api/client';

export type OutputFormat = 'json' | 'table' | 'pretty';

export const OUTPUT_FORMATS: OutputFormat[] = ['json', 'table', 'pretty'];

const SCALARS = new Set(['string', 'number', 'boolean']);

function isScalar(v: unknown): boolean {
  return SCALARS.has(typeof v) || v === null;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function writeOut(text: string): void {
  runtime.printed = true;
  console.log(text);
}

export function print(data: unknown, format: OutputFormat = runtime.output, fields?: string[]): void {
  if (format === 'json') {
    writeOut(JSON.stringify(data ?? null, null, 2));
    return;
  }

  if (Array.isArray(data)) {
    printList(data, format, fields);
  } else if (data && typeof data === 'object') {
    printObject(data as Record<string, unknown>, format);
  } else {
    writeOut(String(data));
  }
}

/** One compact JSON record per line, for --ndjson streams. */
export function printNdjson(records: unknown[]): void {
  for (const r of records) writeOut(JSON.stringify(r));
}

function printList(rows: Record<string, unknown>[], format: OutputFormat, fields?: string[]): void {
  if (rows.length === 0) {
    writeOut(chalk.gray('No results.'));
    return;
  }

  const keys = fields ?? Object.keys(rows[0]).filter(k => isScalar(rows[0][k]));
  const colored = format === 'pretty';

  const table = new Table({
    head: colored ? keys.map(k => chalk.cyan(k)) : keys,
    style: { head: [], border: colored ? [] : ['grey'] },
  });

  for (const row of rows) {
    table.push(keys.map(k => fmt(row[k])));
  }

  writeOut(table.toString());
  if (colored) {
    writeOut(chalk.gray(`${rows.length} result${rows.length !== 1 ? 's' : ''}`));
  }
}

const MAX_VALUE_WIDTH = 96;

function printObject(obj: Record<string, unknown>, format: OutputFormat): void {
  const colored = format === 'pretty';
  const keyWidth = Math.max(...Object.keys(obj).map(k => k.length), 3) + 2;

  // Serialized objects can run to thousands of characters — wrap them rather
  // than letting one field set the width of the whole table.
  const table = new Table({
    style: { head: [], border: [] },
    colWidths: [keyWidth, MAX_VALUE_WIDTH],
    wordWrap: true,
  });

  for (const [k, v] of Object.entries(obj)) {
    const key = colored ? chalk.cyan(k) : k;
    table.push({ [key]: fmt(v) });
  }

  writeOut(table.toString());
}

let pendingSuccess: Record<string, unknown> | null = null;

/**
 * A confirmation line for humans. In json mode stdout must stay one parseable
 * document, so the message is held back and only printed — as
 * {"ok":true,"message":…} — if the command produced no other output.
 */
export function success(msg: string, extra: Record<string, unknown> = {}): void {
  if (runtime.output === 'json') {
    pendingSuccess = { ok: true, ...extra, message: msg };
    return;
  }
  writeOut(chalk.green('✓') + ' ' + msg);
}

/** Called after every action: emits the held-back success object, if one is due. */
export function flushSuccess(): void {
  if (runtime.output === 'json' && pendingSuccess !== null && !runtime.printed) {
    writeOut(JSON.stringify(pendingSuccess));
  }
  pendingSuccess = null;
}

/** Prints what a --dry-run would have sent, then exits 0. */
export function printDryRun(request: PlannedRequest): never {
  const out = { dryRun: true, ...request };
  if (runtime.output === 'json') {
    writeOut(JSON.stringify(out, null, 2));
  } else {
    writeOut(chalk.yellow('Dry run — nothing was sent.'));
    writeOut(`${chalk.bold(request.method)} ${request.url}`);
    if (request.query) writeOut(`${chalk.cyan('query')}  ${JSON.stringify(request.query)}`);
    if (request.body !== undefined) writeOut(`${chalk.cyan('body')}\n${JSON.stringify(request.body, null, 2)}`);
    if (request.multipart) writeOut(`${chalk.cyan('multipart')}\n${JSON.stringify(request.multipart, null, 2)}`);
  }
  process.exit(0);
}

/**
 * The single exit path for failures. In json mode stderr gets exactly one
 * {"error":…} object; otherwise a readable message with one line per field
 * error. The exit code says what kind of failure it was.
 */
export function errorOut(e: unknown): never {
  if (e instanceof DryRunStop) printDryRun(e.request);
  const err = typeof e === 'string' ? new UsageError(e) : e;

  if (runtime.output === 'json') {
    process.stderr.write(JSON.stringify(errorJson(err)) + '\n');
  } else {
    const message = err instanceof Error ? err.message : String(err);
    let line = chalk.red('✗') + ' ' + message;
    if (err instanceof ApiError) line += chalk.gray(` (${err.details.method} ${err.details.path})`);
    process.stderr.write(line + '\n');
    const details = err instanceof ApiError
      ? fieldErrorLines(err.details.errors)
      : err instanceof GraphQLError && err.errors.length > 1 ? err.errors.map(x => x.message) : [];
    // A V2 error's title is already built from its messages; don't repeat them.
    const title = err instanceof ApiError ? err.details.title : '';
    for (const d of details) {
      if (d !== title) process.stderr.write(`  - ${d}\n`);
    }
  }
  process.exit(exitCodeOf(err));
}

export interface Spinner {
  start(): Spinner;
  stop(): void;
  fail(): void;
  text: string;
}

/**
 * ora, but only where someone is watching: never in json mode and never when
 * stderr isn't a terminal, so piped output has no escape codes in it.
 */
export function progress(text: string): Spinner {
  if (runtime.output !== 'json' && process.stderr.isTTY) {
    const s = ora(text);
    return {
      start() { s.start(); return this; },
      stop() { s.stop(); },
      fail() { s.stop(); },
      get text() { return s.text; },
      set text(t: string) { s.text = t; },
    };
  }
  const quiet: Spinner = { start: () => quiet, stop() {}, fail() {}, text };
  return quiet;
}
