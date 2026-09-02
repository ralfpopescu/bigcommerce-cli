import chalk from 'chalk';
import Table from 'cli-table3';

export type OutputFormat = 'json' | 'table' | 'pretty';

const SCALARS = new Set(['string', 'number', 'boolean']);

function isScalar(v: unknown): boolean {
  return SCALARS.has(typeof v) || v === null;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function print(data: unknown, format: OutputFormat, fields?: string[]): void {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (Array.isArray(data)) {
    printList(data, format, fields);
  } else if (data && typeof data === 'object') {
    printObject(data as Record<string, unknown>, format);
  } else {
    console.log(data);
  }
}

function printList(rows: Record<string, unknown>[], format: OutputFormat, fields?: string[]): void {
  if (rows.length === 0) {
    console.log(chalk.gray('No results.'));
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

  console.log(table.toString());
  if (colored) {
    console.log(chalk.gray(`${rows.length} result${rows.length !== 1 ? 's' : ''}`));
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

  console.log(table.toString());
}

export function success(msg: string): void {
  console.log(chalk.green('✓') + ' ' + msg);
}

export function errorOut(msg: string): void {
  console.error(chalk.red('✗') + ' ' + msg);
  process.exit(1);
}
