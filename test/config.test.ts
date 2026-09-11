import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  configDir,
  credentialsPath,
  getProfile,
  readCredentials,
  removeProfile,
  setActiveProfile,
  setProfile,
  writeCredentials,
} from '../src/config';

let dir: string;
const saved = { ...process.env };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bigc-test-'));
  process.env.BIGC_CONFIG_DIR = dir;
  delete process.env.BIGC_STORE_HASH;
  delete process.env.BIGC_TOKEN;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  process.env = { ...saved };
});

describe('config paths', () => {
  it('honours BIGC_CONFIG_DIR', () => {
    expect(configDir()).toBe(dir);
    expect(credentialsPath()).toBe(path.join(dir, 'credentials.json'));
  });

  it('falls back to ~/.bc-cli when the override is unset', () => {
    delete process.env.BIGC_CONFIG_DIR;

    expect(configDir()).toBe(path.join(os.homedir(), '.bc-cli'));
  });
});

describe('reading and writing credentials', () => {
  it('returns an empty set when no file exists', () => {
    expect(readCredentials()).toEqual({ activeProfile: 'default', profiles: {} });
  });

  it('round-trips through disk', () => {
    writeCredentials({
      activeProfile: 'staging',
      profiles: { staging: { storeHash: 'h1', accessToken: 't1' } },
    });

    expect(readCredentials()).toEqual({
      activeProfile: 'staging',
      profiles: { staging: { storeHash: 'h1', accessToken: 't1' } },
    });
  });

  it('creates the directory owner-only', () => {
    setProfile('default', 'h1', 't1');

    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('writes the credentials file owner-only', () => {
    setProfile('default', 'h1', 't1');

    expect(fs.statSync(credentialsPath()).mode & 0o777).toBe(0o600);
  });

  it('tightens the mode on a file that already existed with loose permissions', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(credentialsPath(), '{"activeProfile":"default","profiles":{}}', {
      mode: 0o644,
    });
    fs.chmodSync(credentialsPath(), 0o644);

    setProfile('default', 'h1', 't1');

    expect(fs.statSync(credentialsPath()).mode & 0o777).toBe(0o600);
  });

  it('explains itself when the file is corrupt', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(credentialsPath(), 'not json at all');

    expect(() => readCredentials()).toThrow(/is not valid JSON/);
  });

  it('rejects a JSON file that is not an object', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(credentialsPath(), '"a string"');

    expect(() => readCredentials()).toThrow(/is not valid JSON/);
  });

  it('tolerates a file missing its keys', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(credentialsPath(), '{}');

    expect(readCredentials()).toEqual({ activeProfile: 'default', profiles: {} });
  });
});

describe('profile management', () => {
  it('makes the first saved profile active', () => {
    setProfile('first', 'h1', 't1');

    expect(readCredentials().activeProfile).toBe('first');
  });

  it('leaves the active profile alone when adding a second', () => {
    setProfile('first', 'h1', 't1');
    setProfile('second', 'h2', 't2');

    expect(readCredentials().activeProfile).toBe('first');
  });

  it('overwrites an existing profile in place', () => {
    setProfile('first', 'h1', 't1');
    setProfile('first', 'h2', 't2');

    expect(readCredentials().profiles.first).toEqual({ storeHash: 'h2', accessToken: 't2' });
  });

  it('switches the active profile', () => {
    setProfile('first', 'h1', 't1');
    setProfile('second', 'h2', 't2');
    setActiveProfile('second');

    expect(readCredentials().activeProfile).toBe('second');
  });

  it('refuses to activate a profile that does not exist', () => {
    expect(() => setActiveProfile('ghost')).toThrow('Profile "ghost" not found');
  });

  it('removes a profile', () => {
    setProfile('first', 'h1', 't1');
    setProfile('second', 'h2', 't2');
    removeProfile('first');

    expect(Object.keys(readCredentials().profiles)).toEqual(['second']);
  });

  it('reassigns the active profile when the active one is removed', () => {
    setProfile('first', 'h1', 't1');
    setProfile('second', 'h2', 't2');
    removeProfile('first');

    expect(readCredentials().activeProfile).toBe('second');
  });

  it('empties the active profile when the last one is removed', () => {
    setProfile('only', 'h1', 't1');
    removeProfile('only');

    expect(readCredentials().activeProfile).toBe('');
  });

  it('refuses to remove a profile that does not exist', () => {
    expect(() => removeProfile('ghost')).toThrow('Profile "ghost" not found');
  });
});

describe('getProfile resolution', () => {
  it('prefers the environment over the active profile', () => {
    setProfile('default', 'disk-hash', 'disk-token');
    process.env.BIGC_STORE_HASH = 'env-hash';
    process.env.BIGC_TOKEN = 'env-token';

    expect(getProfile()).toEqual({ storeHash: 'env-hash', accessToken: 'env-token' });
  });

  it('ignores the environment when a profile is named explicitly', () => {
    setProfile('staging', 'disk-hash', 'disk-token');
    process.env.BIGC_STORE_HASH = 'env-hash';
    process.env.BIGC_TOKEN = 'env-token';

    expect(getProfile('staging')).toEqual({ storeHash: 'disk-hash', accessToken: 'disk-token' });
  });

  it('ignores a half-configured environment', () => {
    setProfile('default', 'disk-hash', 'disk-token');
    process.env.BIGC_STORE_HASH = 'env-hash';

    expect(getProfile()).toEqual({ storeHash: 'disk-hash', accessToken: 'disk-token' });
  });

  it('reads the active profile from disk', () => {
    setProfile('first', 'h1', 't1');
    setProfile('second', 'h2', 't2');
    setActiveProfile('second');

    expect(getProfile()).toEqual({ storeHash: 'h2', accessToken: 't2' });
  });

  it('names the missing profile and suggests a fix', () => {
    expect(() => getProfile('ghost')).toThrow(
      'Profile "ghost" not found. Run: bigc auth login --profile ghost, or set BIGC_STORE_HASH and BIGC_TOKEN.',
    );
  });

  it('omits the --profile hint when no profile was named', () => {
    expect(() => getProfile()).toThrow(
      'Profile "default" not found. Run: bigc auth login, or set BIGC_STORE_HASH and BIGC_TOKEN.',
    );
  });
});
