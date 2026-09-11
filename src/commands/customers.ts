import { Command } from 'commander';
import * as fs from 'fs';
import ora from 'ora';

import { createClient } from '../api/factory';
import { errorOut, OutputFormat, print, success } from '../output';
import { queryOption, queryParams } from '../resource';
import { paramsFor } from '../resources';

const CUSTOMER_FIELDS = [
  'id',
  'first_name',
  'last_name',
  'email',
  'company',
  'phone',
  'customer_group_id',
  'date_created',
];

function parseInput(opts: { data?: string; file?: string }): unknown {
  if (opts.data) {
    return JSON.parse(opts.data);
  }

  if (opts.file) {
    return JSON.parse(fs.readFileSync(opts.file, 'utf-8'));
  }

  throw new Error('Provide --data <json> or --file <path>');
}

function addOpts(cmd: Command): Command {
  return cmd
    .option('-o, --output <format>', 'output format: json|table|pretty', 'pretty')
    .option('--profile <name>', 'credential profile');
}

export function registerCustomers(program: Command): void {
  const customers = program.command('customers').description('Manage customers');

  addOpts(
    queryOption(
      customers
        .command('list')
        .description('List customers')
        .option('--page <n>', 'page number', '1')
        .option('--limit <n>', 'results per page (max 250)', '50')
        .option('--all', 'fetch all pages'),
      paramsFor('customers'),
    ),
  ).action(
    async (opts: {
      page: string;
      limit: string;
      all?: boolean;
      query: Record<string, string>;
      output: OutputFormat;
      profile?: string;
    }) => {
      const spinner = ora('Fetching customers...').start();

      try {
        const bc = createClient(opts.profile);
        const filters = queryParams(opts, paramsFor('customers'));
        let data: unknown;

        if (opts.all) {
          data = await bc.getAllV3('customers', filters);
        } else {
          const res: { data?: unknown } = await bc.get('v3', 'customers', {
            ...filters,
            page: opts.page,
            limit: opts.limit,
          });

          data = res.data;
        }

        spinner.stop();
        print(data, opts.output, CUSTOMER_FIELDS);
      } catch (e) {
        spinner.fail();
        errorOut((e as Error).message);
      }
    },
  );

  addOpts(
    customers.command('get').description('Get a customer by ID').argument('<id>', 'customer ID'),
  ).action(async (id: string, opts: { output: OutputFormat; profile?: string }) => {
    try {
      const bc = createClient(opts.profile);
      const res = await bc.get<{ data?: unknown[] }>('v3', 'customers', { 'id:in': id });
      const customer = (res.data ?? [])[0];

      if (!customer) {
        errorOut(`Customer ${id} not found`);
      }

      print(customer, opts.output);
    } catch (e) {
      errorOut((e as Error).message);
    }
  });

  addOpts(
    customers
      .command('create')
      .description('Create a customer')
      .option('--data <json>', 'customer JSON (object or array)')
      .option('--file <path>', 'path to JSON file'),
  ).action(
    async (opts: { data?: string; file?: string; output: OutputFormat; profile?: string }) => {
      const spinner = ora('Creating customer...').start();

      try {
        const bc = createClient(opts.profile);
        const input = parseInput(opts);
        const body = Array.isArray(input) ? input : [input];
        const res = await bc.post<{ data?: unknown[] }>('v3', 'customers', body);

        spinner.stop();
        success(`Created ${(res.data ?? []).length} customer(s)`);
        print(res.data, opts.output, CUSTOMER_FIELDS);
      } catch (e) {
        spinner.fail();
        errorOut((e as Error).message);
      }
    },
  );

  addOpts(
    customers
      .command('update')
      .description('Update a customer')
      .argument('<id>', 'customer ID')
      .option('--data <json>', 'fields to update as JSON')
      .option('--file <path>', 'path to JSON file'),
  ).action(
    async (
      id: string,
      opts: { data?: string; file?: string; output: OutputFormat; profile?: string },
    ) => {
      const spinner = ora('Updating customer...').start();

      try {
        const bc = createClient(opts.profile);
        const input = parseInput(opts) as Record<string, unknown>;
        const body = [{ ...input, id: parseInt(id, 10) }];
        const res = await bc.put<{ data?: unknown[] }>('v3', 'customers', body);

        spinner.stop();
        success(`Customer ${id} updated`);
        print((res.data ?? [])[0], opts.output);
      } catch (e) {
        spinner.fail();
        errorOut((e as Error).message);
      }
    },
  );

  addOpts(
    customers.command('delete').description('Delete a customer').argument('<id>', 'customer ID'),
  ).action(async (id: string, opts: { output: OutputFormat; profile?: string }) => {
    const spinner = ora('Deleting customer...').start();

    try {
      const bc = createClient(opts.profile);

      await bc.del('v3', 'customers', { 'id:in': id });
      spinner.stop();
      success(`Customer ${id} deleted`);
    } catch (e) {
      spinner.fail();
      errorOut((e as Error).message);
    }
  });
}
