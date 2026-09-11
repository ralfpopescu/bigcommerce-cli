import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logged: string[] = [];
const succeeded: string[] = [];

vi.mock('../../src/output', async () => {
  const actual = await vi.importActual<typeof import('../../src/output')>('../../src/output');

  return {
    ...actual,
    print: vi.fn(),
    success: (msg: string) => {
      succeeded.push(msg);
    },
    info: (msg: string) => {
      logged.push(msg);
    },
  };
});

import { registerAuth } from '../../src/commands/auth';
import { readCredentials, setProfile } from '../../src/config';

let dir: string;
const savedEnv = { ...process.env };
let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bigc-auth-'));
  process.env.BIGC_CONFIG_DIR = dir;
  logged.length = 0;
  succeeded.length = 0;
  consoleSpy = vi.spyOn(console, 'log').mockImplementation((msg: unknown) => {
    logged.push(String(msg));
  });
});

afterEach(() => {
  consoleSpy.mockRestore();
  fs.rmSync(dir, { recursive: true, force: true });
  process.env = { ...savedEnv };
});

function program(): Command {
  const p = new Command();

  p.exitOverride();
  registerAuth(p);

  return p;
}

function run(argv: string[]): Promise<unknown> {
  return program().parseAsync(['node', 'bigc', ...argv]);
}

describe('auth login', () => {
  it('saves a profile from flags without prompting', async () => {
    await run(['auth', 'login', '--store-hash', 'abc123', '--token', 'tok']);

    expect(readCredentials().profiles.default).toEqual({
      storeHash: 'abc123',
      accessToken: 'tok',
    });
  });

  it('saves under a named profile', async () => {
    await run(['auth', 'login', '--profile', 'staging', '--store-hash', 'h', '--token', 't']);

    expect(Object.keys(readCredentials().profiles)).toEqual(['staging']);
  });

  it('confirms the save without echoing the token', async () => {
    await run(['auth', 'login', '--store-hash', 'abc123', '--token', 'super-secret']);

    const output = succeeded.join(' ');

    expect(output).toContain('abc123');
    expect(output).not.toContain('super-secret');
  });
});

describe('auth list', () => {
  it('says so when nothing is saved', async () => {
    await run(['auth', 'list']);

    expect(logged.join(' ')).toMatch(/No profiles saved/);
  });

  it('lists saved profiles and marks the active one', async () => {
    setProfile('first', 'h1', 't1');
    setProfile('second', 'h2', 't2');

    await run(['auth', 'list']);

    const output = logged.join('\n');

    expect(output).toContain('first');
    expect(output).toContain('second');
    expect(output).toMatch(/first.*\(active\)/);
  });

  it('never prints an access token', async () => {
    setProfile('first', 'h1', 'super-secret-token');

    await run(['auth', 'list']);

    expect(logged.join('\n')).not.toContain('super-secret-token');
  });
});

describe('auth use and logout', () => {
  it('switches the active profile', async () => {
    setProfile('first', 'h1', 't1');
    setProfile('second', 'h2', 't2');

    await run(['auth', 'use', 'second']);

    expect(readCredentials().activeProfile).toBe('second');
  });

  it('reports a profile that does not exist', async () => {
    await expect(run(['auth', 'use', 'ghost'])).rejects.toThrow('Profile "ghost" not found');
  });

  it('removes a profile', async () => {
    setProfile('default', 'h1', 't1');

    await run(['auth', 'logout']);

    expect(readCredentials().profiles).toEqual({});
  });

  it('reports removing a profile that does not exist', async () => {
    await expect(run(['auth', 'logout', '--profile', 'ghost'])).rejects.toThrow(
      'Profile "ghost" not found',
    );
  });
});
