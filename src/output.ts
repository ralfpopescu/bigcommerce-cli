import chalk from 'chalk';
// eslint-disable-next-line import/no-named-as-default -- cli-table3's default export is the table class.
import Table from 'cli-table3';

export type OutputFormat = 'json' | 'table' | 'pretty';

const SCALARS = new Set(['string', 'number', 'boolean']);
const MAX_VALUE_WIDTH = 96;
const MIN_KEY_WIDTH = 3;

/**
 * Thrown instead of calling process.exit() from deep in the call tree, so the
 * entry point owns the exit code and tests can assert on failures.
 */
export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

function isScalar(v: unknown): boolean {
  return SCALARS.has(typeof v) || v === null;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) {
    return '';
  }

  if (typeof v === 'object') {
    return JSON.stringify(v);
  }

  if (typeof v === 'string') {
    return v;
  }

  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') {
    return String(v);
  }

  // A function or symbol: nothing meaningful to render.
  return '';
}

/** Renders a value in the requested format. Pure: returns the text, prints nothing. */
export function format(data: unknown, outputFormat: OutputFormat, fields?: string[]): string {
  if (outputFormat === 'json') {
    return JSON.stringify(data, null, 2);
  }

  if (Array.isArray(data)) {
    return formatList(data as Array<Record<string, unknown>>, outputFormat, fields);
  }

  if (data !== null && typeof data === 'object') {
    return formatObject(data as Record<string, unknown>, outputFormat);
  }

  return fmt(data);
}

function formatList(
  rows: Array<Record<string, unknown>>,
  outputFormat: OutputFormat,
  fields?: string[],
): string {
  const first = rows[0];

  if (first === undefined) {
    return chalk.gray('No results.');
  }

  const keys = fields ?? Object.keys(first).filter((k) => isScalar(first[k]));
  const colored = outputFormat === 'pretty';

  const table = new Table({
    head: colored ? keys.map((k) => chalk.cyan(k)) : keys,
    style: { head: [], border: colored ? [] : ['grey'] },
  });

  for (const row of rows) {
    table.push(keys.map((k) => fmt(row[k])));
  }

  if (!colored) {
    return table.toString();
  }

  return `${table.toString()}\n${chalk.gray(`${rows.length} result${rows.length === 1 ? '' : 's'}`)}`;
}

function formatObject(obj: Record<string, unknown>, outputFormat: OutputFormat): string {
  const colored = outputFormat === 'pretty';
  const keyWidth = Math.max(...Object.keys(obj).map((k) => k.length), MIN_KEY_WIDTH) + 2;

  // Serialized objects can run to thousands of characters — wrap them rather
  // than letting one field set the width of the whole table.
  const table = new Table({
    style: { head: [], border: [] },
    colWidths: [keyWidth, MAX_VALUE_WIDTH],
    wordWrap: true,
  });

  for (const [k, v] of Object.entries(obj)) {
    table.push({ [colored ? chalk.cyan(k) : k]: fmt(v) });
  }

  return table.toString();
}

export function successMessage(msg: string): string {
  return `${chalk.green('✓')} ${msg}`;
}

/* eslint-disable no-console */

export function print(data: unknown, outputFormat: OutputFormat, fields?: string[]): void {
  console.log(format(data, outputFormat, fields));
}

export function success(msg: string): void {
  console.log(successMessage(msg));
}

export function info(msg: string): void {
  console.log(msg);
}

/** A non-fatal problem. Goes to stderr so it can't corrupt piped output. */
export function warn(msg: string): void {
  console.error(`${chalk.yellow('!')} ${msg}`);
}

/* eslint-enable no-console */

/**
 * Reports a failure. Throws rather than exiting, so the entry point decides the
 * exit code and a test can catch it.
 */
export function errorOut(msg: string): never {
  throw new CliError(msg);
}
