import { Command } from 'commander';
import * as readline from 'readline';
import {
  readCredentials,
  setProfile,
  removeProfile,
  setActiveProfile,
} from '../config';
import { success, errorOut } from '../output';
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
    .action(async (opts: { profile: string; storeHash?: string; token?: string }) => {
      try {
        // Prompt only for what wasn't passed, so this works in a script.
        if (!opts.storeHash || !opts.token) {
          console.log(chalk.bold('\nBigCommerce API credentials'));
          console.log(chalk.gray('Find these in: Store Control Panel → Advanced Settings → API Accounts\n'));
        }
        const storeHash = opts.storeHash ?? await prompt('Store hash: ');
        const accessToken = opts.token ?? await promptSecret('Access token: ');
        closePrompts();
        if (!storeHash || !accessToken) errorOut('Store hash and access token are required');
        setProfile(opts.profile, storeHash, accessToken);
        success(`Saved profile "${opts.profile}" (store: ${storeHash})`);
      } catch (e) {
        closePrompts();
        errorOut((e as Error).message);
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
        errorOut((e as Error).message);
      }
    });

  auth
    .command('list')
    .description('List saved profiles')
    .action(() => {
      const creds = readCredentials();
      const profiles = Object.entries(creds.profiles);
      if (profiles.length === 0) {
        console.log(chalk.gray('No profiles saved. Run: bigc auth login'));
        return;
      }
      for (const [name, p] of profiles) {
        const active = name === creds.activeProfile ? chalk.green(' (active)') : '';
        console.log(`  ${chalk.cyan(name)}${active}  store: ${p.storeHash}`);
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
        errorOut((e as Error).message);
      }
    });
}
