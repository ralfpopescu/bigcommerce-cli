import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.bc-cli');
const CREDENTIALS_FILE = path.join(CONFIG_DIR, 'credentials.json');

const ENV_STORE_HASH = 'BIGC_STORE_HASH';
const ENV_TOKEN = 'BIGC_TOKEN';

export interface Profile {
  storeHash: string;
  accessToken: string;
}

export interface Credentials {
  activeProfile: string;
  profiles: Record<string, Profile>;
}

// 0o700: the token lives in here, so keep the directory owner-only rather than
// inheriting whatever the umask happens to be.
function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

export function readCredentials(): Credentials {
  ensureConfigDir();
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    return { activeProfile: 'default', profiles: {} };
  }
  const raw = fs.readFileSync(CREDENTIALS_FILE, 'utf-8');
  try {
    return JSON.parse(raw) as Credentials;
  } catch {
    throw new Error(
      `${CREDENTIALS_FILE} is not valid JSON. Fix or delete it, then run: bigc auth login`
    );
  }
}

export function writeCredentials(creds: Credentials): void {
  ensureConfigDir();
  // mode on write covers file creation; the chmod covers a file that already
  // existed, where the mode argument is ignored.
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  fs.chmodSync(CREDENTIALS_FILE, 0o600);
}

/**
 * Resolve credentials for a command. An explicitly named profile always comes
 * from disk; otherwise BIGC_STORE_HASH/BIGC_TOKEN win over the active profile,
 * so CI can authenticate without writing a token to the filesystem.
 */
export function getProfile(name?: string): Profile {
  if (!name) {
    const storeHash = process.env[ENV_STORE_HASH];
    const accessToken = process.env[ENV_TOKEN];
    if (storeHash && accessToken) return { storeHash, accessToken };
  }

  const creds = readCredentials();
  const profileName = name ?? creds.activeProfile;
  const profile = creds.profiles[profileName];
  if (!profile) {
    throw new Error(
      `Profile "${profileName}" not found. Run: bigc auth login${name ? ` --profile ${name}` : ''}` +
        `, or set ${ENV_STORE_HASH} and ${ENV_TOKEN}.`
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
  if (!creds.profiles[name]) throw new Error(`Profile "${name}" not found`);
  delete creds.profiles[name];
  if (creds.activeProfile === name) {
    creds.activeProfile = Object.keys(creds.profiles)[0] ?? '';
  }
  writeCredentials(creds);
}

export function setActiveProfile(name: string): void {
  const creds = readCredentials();
  if (!creds.profiles[name]) throw new Error(`Profile "${name}" not found`);
  creds.activeProfile = name;
  writeCredentials(creds);
}
