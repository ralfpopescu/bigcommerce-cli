import { describe, expect, it } from 'vitest';
import { runCli } from './support/cli';

const { version } = require('../package.json');

describe('bigc --version', () => {
  it('prints the package version', async () => {
    const r = await runCli(['--version']);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(version);
  });
});
