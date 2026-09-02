#!/usr/bin/env node
import { Command } from 'commander';
import { registerAuth } from './commands/auth';
import { registerCatalog } from './commands/catalog';
import { registerOrders } from './commands/orders';
import { registerCustomers } from './commands/customers';
import { registerChannels } from './commands/channels';
import { registerInventory } from './commands/inventory';
import { registerApi, registerPaymentProcessing } from './commands/api';
import { mountAll } from './resource';
import { RESOURCES } from './resources';

// Resolved at runtime so the CLI version can't drift from package.json.
// Correct from both dist/index.js and src/index.ts under ts-node.
const { version } = require('../package.json') as { version: string };

const program = new Command();

program
  .name('bigc')
  .description('BigCommerce API CLI')
  .version(version);

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

const payments = program.commands.find(c => c.name() === 'payments');
if (payments) registerPaymentProcessing(payments);

program.parseAsync(process.argv).catch(err => {
  console.error(err.message);
  process.exit(1);
});
