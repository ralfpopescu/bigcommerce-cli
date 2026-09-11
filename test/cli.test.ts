import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * End-to-end checks against the built entry point. These run the real binary in
 * a child process, so they cover index.ts wiring that unit tests bypass.
 */

const ENTRY = path.join(__dirname, '..', 'dist', 'index.js');
const built = fs.existsSync(ENTRY);
const describeBuilt = built ? describe : describe.skip;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bigc-cli-'));

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

interface Result {
  status: number;
  stdout: string;
  stderr: string;
}

function bigc(args: string[]): Result {
  try {
    const stdout = execFileSync(process.execPath, [ENTRY, ...args], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        BIGC_CONFIG_DIR: dir,
        BIGC_STORE_HASH: '',
        BIGC_TOKEN: '',
        // Keep chalk from emitting escape codes into the assertions.
        NO_COLOR: '1',
        FORCE_COLOR: '0',
      },
    });

    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status: number | null; stdout?: string; stderr?: string };

    return { status: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describeBuilt('the built CLI', () => {
  it('reports its version', () => {
    const { status, stdout } = bigc(['--version']);

    expect(status).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('matches the version in package.json', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'),
    ) as { version: string };

    expect(bigc(['--version']).stdout.trim()).toBe(pkg.version);
  });

  it('prints help and exits zero', () => {
    const { status, stdout } = bigc(['--help']);

    expect(status).toBe(0);
    expect(stdout).toContain('BigCommerce API CLI');
    expect(stdout).toContain('auth');
    expect(stdout).toContain('catalog');
  });

  it('exposes help for a nested group', () => {
    const { status, stdout } = bigc(['catalog', 'products', '--help']);

    expect(status).toBe(0);
    expect(stdout).toContain('list');
    expect(stdout).toContain('create');
  });

  it('exits non-zero on an unknown command', () => {
    expect(bigc(['definitely-not-a-command']).status).not.toBe(0);
  });

  it('fails with a helpful message when no credentials are configured', () => {
    const { status, stderr, stdout } = bigc(['catalog', 'products', 'list']);

    expect(status).toBe(1);
    expect(`${stderr}${stdout}`).toMatch(/not found.*bigc auth login/s);
  });

  it('does not leak a token into auth list output', () => {
    execFileSync(
      process.execPath,
      [ENTRY, 'auth', 'login', '--store-hash', 'abc123', '--token', 'super-secret-token'],
      { encoding: 'utf-8', env: { ...process.env, BIGC_CONFIG_DIR: dir, NO_COLOR: '1' } },
    );

    const { stdout } = bigc(['auth', 'list']);

    expect(stdout).toContain('abc123');
    expect(stdout).not.toContain('super-secret-token');
  });

  it('stores credentials with owner-only permissions', () => {
    const file = path.join(dir, 'credentials.json');

    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });
});
