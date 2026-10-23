#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import chalk from 'chalk';
import { registerAuth } from './commands/auth';
import { registerCatalog } from './commands/catalog';
import { registerOrders } from './commands/orders';
import { registerCustomers } from './commands/customers';
import { registerChannels } from './commands/channels';
import { registerInventory } from './commands/inventory';
import { registerApi, registerPaymentProcessing } from './commands/api';
import { registerDoctor } from './commands/doctor';
import { registerDiscovery, finalizeCommands } from './commands/discovery';
import { registerStorefrontGraphql, registerAdminGraphqlSchema } from './commands/storefront';
import { mountAll } from './resource';
import { RESOURCES } from './resources';
import { runtime } from './runtime';
import { errorOut, flushSuccess, OUTPUT_FORMATS, OutputFormat } from './output';
import { jsonByDefault } from './shared';
import { EXIT, UsageError } from './errors';

// Resolved at runtime so the CLI version can't drift from package.json.
// Correct from both dist/index.js and src/index.ts under ts-node.
const { version } = require('../package.json') as { version: string };

/**
 * --output beats BIGC_OUTPUT beats the default. The default is `pretty` for a
 * person at a terminal and `json` whenever stdout is piped — the caller is a
 * program, and a program wants something it can parse.
 */
function resolveOutput(flag: unknown, jsonFallback: boolean): OutputFormat {
  const chosen = flag ?? (process.env.BIGC_OUTPUT || undefined);
  if (chosen !== undefined) {
    if (!OUTPUT_FORMATS.includes(chosen as OutputFormat)) {
      throw new UsageError(`Unknown output format "${chosen}". Use one of: ${OUTPUT_FORMATS.join(', ')}`);
    }
    return chosen as OutputFormat;
  }
  if (!process.stdout.isTTY) return 'json';
  return jsonFallback ? 'json' : 'pretty';
}

/**
 * The format has to be known before commander parses anything, so that its
 * own usage errors come out in the right shape. This reads --output straight
 * from argv; the preAction hook settles it properly once parsing is done.
 */
function prescanOutput(argv: string[]): OutputFormat {
  let flag: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--output' || a === '-o') flag = argv[i + 1];
    else if (a.startsWith('--output=')) flag = a.slice('--output='.length);
    else if (a.startsWith('-o') && a.length > 2 && !a.startsWith('--')) flag = a.slice(2);
  }
  try {
    return resolveOutput(flag, false);
  } catch {
    return 'pretty';
  }
}

runtime.output = prescanOutput(process.argv.slice(2));

const program = new Command();

// Both settings are inherited by every command created after this point, which
// is all of them.
program
  .exitOverride()
  .configureOutput({
    outputError: (str, write) => {
      if (runtime.output === 'json') {
        write(JSON.stringify({ error: { type: 'usage', title: str.replace(/^error:\s*/, '').trim() } }) + '\n');
      } else {
        write(str);
      }
    },
  });

program
  .name('bigc')
  .description('BigCommerce API CLI')
  .version(version);

program.hook('preAction', (_root, action) => {
  // optsWithGlobals: a subcommand like `graphql schema` shares options with its parent.
  const opts = action.optsWithGlobals() as { output?: unknown; dryRun?: boolean; ndjson?: boolean };
  runtime.ndjson = Boolean(opts.ndjson);
  // NDJSON is a JSON format; anything else would mix tables into the stream.
  runtime.output = runtime.ndjson ? 'json' : resolveOutput(opts.output, jsonByDefault.has(action));
  if (action.options.some(o => o.attributeName() === 'output')) {
    action.setOptionValue('output', runtime.output);
  }
  runtime.dryRun = Boolean(opts.dryRun);
  if (runtime.output === 'json') chalk.level = 0;
});

program.hook('postAction', () => flushSuccess());

registerAuth(program);
registerDoctor(program, version);
registerApi(program);

// Hand-written commands go on first: multipart uploads and other behaviour the
// generic builders can't express. `mountAll` then fills in everything else and
// leaves anything already registered alone.
registerCatalog(program);
registerOrders(program);
registerCustomers(program);
registerChannels(program);
registerInventory(program);

mountAll(program, RESOURCES);

const payments = program.commands.find(c => c.name() === 'payments');
if (payments) registerPaymentProcessing(payments);
registerStorefrontGraphql(program);
registerAdminGraphqlSchema(program);

// Last, so the catalog sees every command registered above.
registerDiscovery(program);
finalizeCommands(program);

program.parseAsync(process.argv).catch(err => {
  if (err instanceof CommanderError) {
    // --help and --version arrive here too, with exit code 0. Everything else
    // commander rejects is a usage problem, and it has already said what.
    process.exit(err.exitCode === 0 ? EXIT.ok : EXIT.usage);
  }
  errorOut(err);
});
