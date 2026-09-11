import chalk from 'chalk';
import { describe, expect, it } from 'vitest';

import { CliError, errorOut, format, successMessage } from '../src/output';

// chalk auto-detects colour support; pin it so assertions are stable in CI.
chalk.level = 0;

describe('json format', () => {
  it('pretty-prints with two-space indentation', () => {
    expect(format({ id: 1, name: 'Widget' }, 'json')).toBe('{\n  "id": 1,\n  "name": "Widget"\n}');
  });

  it('passes arrays through unchanged', () => {
    expect(format([1, 2], 'json')).toBe('[\n  1,\n  2\n]');
  });

  it('renders null', () => {
    expect(format(null, 'json')).toBe('null');
  });
});

describe('list formatting', () => {
  const rows = [
    { id: 1, name: 'Widget', price: 9.99 },
    { id: 2, name: 'Gadget', price: 19.5 },
  ];

  it('renders a header and one row per record', () => {
    const out = format(rows, 'table');

    expect(out).toContain('id');
    expect(out).toContain('Widget');
    expect(out).toContain('Gadget');
    expect(out).toContain('19.5');
  });

  it('restricts columns to the requested fields', () => {
    const out = format(rows, 'table', ['name']);

    expect(out).toContain('name');
    expect(out).not.toContain('9.99');
  });

  it('drops non-scalar columns when no fields are given', () => {
    const out = format([{ id: 1, tags: ['a', 'b'] }], 'table');

    expect(out).toContain('id');
    expect(out).not.toContain('tags');
  });

  it('keeps a non-scalar column when it was asked for explicitly', () => {
    const out = format([{ id: 1, tags: ['a'] }], 'table', ['tags']);

    expect(out).toContain('["a"]');
  });

  it('says so when there are no results', () => {
    expect(format([], 'table')).toBe('No results.');
  });

  it('appends a pluralized count in pretty mode', () => {
    expect(format(rows, 'pretty')).toContain('2 results');
  });

  it('uses the singular for one result', () => {
    expect(format([rows[0]], 'pretty')).toContain('1 result');
    expect(format([rows[0]], 'pretty')).not.toContain('1 results');
  });

  it('omits the count in table mode', () => {
    expect(format(rows, 'table')).not.toContain('2 results');
  });

  it('takes its columns from the first row', () => {
    const out = format([{ id: 1 }, { id: 2, extra: 'ignored' }], 'table');

    expect(out).not.toContain('extra');
  });

  it('renders a missing value as blank rather than "undefined"', () => {
    const out = format([{ id: 1, name: 'a' }, { id: 2 }], 'table');

    expect(out).not.toContain('undefined');
  });
});

describe('object formatting', () => {
  it('renders one row per key', () => {
    const out = format({ id: 7, sku: 'A-1' }, 'table');

    expect(out).toContain('id');
    expect(out).toContain('sku');
    expect(out).toContain('A-1');
  });

  it('serializes nested values', () => {
    expect(format({ meta: { a: 1 } }, 'table')).toContain('{"a":1}');
  });

  it('wraps a very long value instead of widening the table', () => {
    const out = format({ description: 'x'.repeat(400) }, 'table');
    const widest = Math.max(...out.split('\n').map((l) => l.length));

    expect(widest).toBeLessThan(140);
  });

  it('renders null as blank', () => {
    expect(format({ a: null }, 'table')).not.toContain('null');
  });
});

describe('scalar formatting', () => {
  it('renders a bare string', () => {
    expect(format('User-agent: *', 'pretty')).toBe('User-agent: *');
  });

  it('renders a bare number', () => {
    expect(format(42, 'pretty')).toBe('42');
  });

  it('renders null as blank', () => {
    expect(format(null, 'pretty')).toBe('');
  });
});

describe('messages and errors', () => {
  it('marks a success', () => {
    expect(successMessage('Created')).toBe('✓ Created');
  });

  it('throws a CliError with exit code 1 by default', () => {
    expect(() => errorOut('boom')).toThrow(CliError);
    expect(() => errorOut('boom')).toThrow('boom');
  });

  it('carries the exit code', () => {
    try {
      errorOut('boom');
    } catch (e) {
      expect((e as CliError).exitCode).toBe(1);
      expect((e as CliError).name).toBe('CliError');
    }
  });

  it('does not terminate the process', () => {
    // Regression guard: errorOut used to call process.exit(1), which made the
    // failure path untestable and killed the process mid-command.
    expect(() => errorOut('boom')).toThrow();
    expect(process.exitCode).toBeUndefined();
  });
});
