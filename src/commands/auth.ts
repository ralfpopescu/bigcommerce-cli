import { Command } from 'commander';
import * as readline from 'readline';
import {
  readCredentials,
  setProfile,
  removeProfile,
  setActiveProfile,
  setProfileReadOnly,
} from '../config';
import { print, success, errorOut } from '../output';
import { runtime } from '../runtime';
import { UsageError } from '../errors';
import chalk from 'chalk';

// Terminal input goes through readline. Piped input is drained once up front
// instead: a readline interface over a pipe closes as soon as the stream ends,
// so a second question asked after that would never fire.
let piped: string[] | null = null;

async function nextPipedLine(): Promise<string> {
  if (piped === null) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    piped = Buffer.concat(chunks).toString('utf-8').split(/\r?\n/);
  }
  return (piped.shift() ?? '').trim();
}

let iface: readline.Interface | null = null;

function prompts(): readline.Interface {
  if (!iface) {
    iface = readline.createInterface({ input: process.stdin, output: process.stdout });
  }
  return iface;
}

function closePrompts(): void {
  iface?.close();
  iface = null;
}

function prompt(question: string): Promise<string> {
  // Unattended: the question is progress output, so keep stdout clean for data.
  if (!process.stdin.isTTY) {
    process.stderr.write(question);
    return nextPipedLine();
  }
  return new Promise(resolve => {
    prompts().question(question, answer => resolve(answer.trim()));
  });
}

/**
 * Like prompt(), but the typed characters are never echoed — an access token
 * should not end up in the terminal's scrollback. Piped input isn't echoed in
 * the first place, so there it's just a plain prompt.
 */
function promptSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY) return prompt(question);

  const rl = prompts();
  return new Promise(resolve => {
    let muted = false;
    // readline routes every echo through this hook, including the question
    // itself — mute only after the question has been written.
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = s => {
      if (!muted) process.stdout.write(s);
    };
    rl.question(question, answer => {
      muted = false;
      process.stdout.write('\n');
      resolve(answer.trim());
    });
    muted = true;
  });
}

export function registerAuth(program: Command): void {
  const auth = program.command('auth').description('Manage store credentials');

  auth
    .command('login')
    .description('Add or update a credential profile')
    .option('--profile <name>', 'profile name', 'default')
    .option('--store-hash <hash>', 'store hash (skips the prompt)')
    .option('--token <token>', 'access token (skips the prompt)')
    .option('--read-only', 'refuse every write made with this profile')
    .action(async (opts: { profile: string; storeHash?: string; token?: string; readOnly?: boolean }) => {
      try {
        // Prompt only for what wasn't passed, so this works in a script.
        if (!opts.storeHash || !opts.token) {
          // stderr, like the prompts themselves, so stdout stays clean for data.
          console.error(chalk.bold('\nBigCommerce API credentials'));
          console.error(chalk.gray('Find these in: Store Control Panel → Settings → API Accounts\n'));
        }
        const storeHash = opts.storeHash ?? await prompt('Store hash: ');
        const accessToken = opts.token ?? await promptSecret('Access token: ');
        closePrompts();
        if (!storeHash || !accessToken) errorOut('Store hash and access token are required');
        setProfile(opts.profile, storeHash, accessToken, Boolean(opts.readOnly));
        success(`Saved profile "${opts.profile}" (store: ${storeHash}${opts.readOnly ? ', read-only' : ''})`);
      } catch (e) {
        closePrompts();
        errorOut(e);
      }
    });

  auth
    .command('logout')
    .description('Remove a credential profile')
    .option('--profile <name>', 'profile name', 'default')
    .action((opts: { profile: string }) => {
      try {
        removeProfile(opts.profile);
        success(`Removed profile "${opts.profile}"`);
      } catch (e) {
        errorOut(e);
      }
    });

  auth
    .command('set')
    .description('Change a saved profile\'s settings')
    .argument('<profile>', 'profile name')
    .requiredOption('--read-only <bool>', 'true to refuse every write made with this profile, false to allow them')
    .action((profile: string, opts: { readOnly: string }) => {
      try {
        if (!/^(true|false)$/.test(opts.readOnly)) throw new UsageError('--read-only takes true or false');
        const readOnly = opts.readOnly === 'true';
        setProfileReadOnly(profile, readOnly);
        success(`Profile "${profile}" is now ${readOnly ? 'read-only' : 'read-write'}`);
      } catch (e) {
        errorOut(e);
      }
    });

  auth
    .command('list')
    .description('List saved profiles')
    .option('-o, --output <format>', 'output format: json|table|pretty')
    .action(() => {
      const creds = readCredentials();
      const profiles = Object.entries(creds.profiles);
      // Never the token: names, store hashes and flags only.
      if (runtime.output === 'json') {
        print(profiles.map(([name, p]) => ({
          name,
          storeHash: p.storeHash,
          active: name === creds.activeProfile,
          readOnly: Boolean(p.readOnly),
        })));
        return;
      }
      if (profiles.length === 0) {
        console.log(chalk.gray('No profiles saved. Run: bigc auth login'));
        return;
      }
      for (const [name, p] of profiles) {
        const active = name === creds.activeProfile ? chalk.green(' (active)') : '';
        const ro = p.readOnly ? chalk.yellow(' read-only') : '';
        console.log(`  ${chalk.cyan(name)}${active}${ro}  store: ${p.storeHash}`);
      }
    });

  auth
    .command('use')
    .description('Set the active profile')
    .argument('<profile>', 'profile name to activate')
    .action((profile: string) => {
      try {
        setActiveProfile(profile);
        success(`Active profile set to "${profile}"`);
      } catch (e) {
        errorOut(e);
      }
    });
}
