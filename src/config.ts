import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ENV_STORE_HASH = 'BIGC_STORE_HASH';
const ENV_TOKEN = 'BIGC_TOKEN';
const ENV_CONFIG_DIR = 'BIGC_CONFIG_DIR';

const DEFAULT_DIR_NAME = '.bc-cli';
const CREDENTIALS_FILE_NAME = 'credentials.json';

export interface Profile {
  storeHash: string;
  accessToken: string;
}

export interface Credentials {
  activeProfile: string;
  profiles: Record<string, Profile>;
}

/**
 * Resolved per call rather than at module load, so BIGC_CONFIG_DIR can be set
 * by a test or a wrapper script after this module has been imported.
 */
export function configDir(): string {
  return process.env[ENV_CONFIG_DIR] ?? path.join(os.homedir(), DEFAULT_DIR_NAME);
}

export function credentialsPath(): string {
  return path.join(configDir(), CREDENTIALS_FILE_NAME);
}

// 0o700: the token lives in here, so keep the directory owner-only rather than
// inheriting whatever the umask happens to be.
function ensureConfigDir(): string {
  const dir = configDir();

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  return dir;
}

export function readCredentials(): Credentials {
  ensureConfigDir();

  const file = credentialsPath();

  if (!fs.existsSync(file)) {
    return { activeProfile: 'default', profiles: {} };
  }

  const raw = fs.readFileSync(file, 'utf-8');

  try {
    const parsed: unknown = JSON.parse(raw);

    if (parsed === null || typeof parsed !== 'object') {
      throw new Error('not an object');
    }

    const creds = parsed as Partial<Credentials>;

    return {
      activeProfile: creds.activeProfile ?? 'default',
      profiles: creds.profiles ?? {},
    };
  } catch {
    throw new Error(`${file} is not valid JSON. Fix or delete it, then run: bigc auth login`);
  }
}

export function writeCredentials(creds: Credentials): void {
  ensureConfigDir();

  const file = credentialsPath();

  // mode on write covers file creation; the chmod covers a file that already
  // existed, where the mode argument is ignored.
  fs.writeFileSync(file, JSON.stringify(creds, null, 2), { encoding: 'utf-8', mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/**
 * Resolve credentials for a command. An explicitly named profile always comes
 * from disk; otherwise BIGC_STORE_HASH/BIGC_TOKEN win over the active profile,
 * so CI can authenticate without writing a token to the filesystem.
 */
export function getProfile(name?: string): Profile {
  if (name === undefined) {
    const storeHash = process.env[ENV_STORE_HASH];
    const accessToken = process.env[ENV_TOKEN];

    if (storeHash && accessToken) {
      return { storeHash, accessToken };
    }
  }

  const creds = readCredentials();
  const profileName = name ?? creds.activeProfile;
  const profile = creds.profiles[profileName];

  if (!profile) {
    throw new Error(
      `Profile "${profileName}" not found. Run: bigc auth login${
        name === undefined ? '' : ` --profile ${name}`
      }, or set ${ENV_STORE_HASH} and ${ENV_TOKEN}.`,
    );
  }

  return profile;
}

export function setProfile(name: string, storeHash: string, accessToken: string): void {
  const creds = readCredentials();

  creds.profiles[name] = { storeHash, accessToken };

  if (!creds.activeProfile || Object.keys(creds.profiles).length === 1) {
    creds.activeProfile = name;
  }

  writeCredentials(creds);
}

export function removeProfile(name: string): void {
  const creds = readCredentials();

  if (!creds.profiles[name]) {
    throw new Error(`Profile "${name}" not found`);
  }

  const { [name]: _removed, ...rest } = creds.profiles;

  creds.profiles = rest;

  if (creds.activeProfile === name) {
    creds.activeProfile = Object.keys(rest)[0] ?? '';
  }

  writeCredentials(creds);
}

export function setActiveProfile(name: string): void {
  const creds = readCredentials();

  if (!creds.profiles[name]) {
    throw new Error(`Profile "${name}" not found`);
  }

  creds.activeProfile = name;
  writeCredentials(creds);
}
