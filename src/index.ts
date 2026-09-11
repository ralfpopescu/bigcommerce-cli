#!/usr/bin/env node
import chalk from 'chalk';
import { Command } from 'commander';

import { registerApi, registerPaymentProcessing } from './commands/api';
import { registerAuth } from './commands/auth';
import { registerCatalog } from './commands/catalog';
import { registerChannels } from './commands/channels';
import { registerCustomers } from './commands/customers';
import { registerInventory } from './commands/inventory';
import { registerOrders } from './commands/orders';
import { CliError } from './output';
import { mountAll } from './resource';
import { RESOURCES } from './resources';

// Resolved at runtime so the CLI version can't drift from package.json.
// Correct from both dist/index.js and src/index.ts under ts-node.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- read at runtime so the CLI version cannot drift from package.json.
const { version } = require('../package.json') as { version: string };

const program = new Command();

program.name('bigc').description('BigCommerce API CLI').version(version);

registerAuth(program);
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

const payments = program.commands.find((c) => c.name() === 'payments');

if (payments) {
  registerPaymentProcessing(payments);
}

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  const exitCode = err instanceof CliError ? err.exitCode : 1;

  console.error(`${chalk.red('\u2717')} ${message}`);
  process.exitCode = exitCode;
});
