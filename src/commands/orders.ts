import * as fs from 'fs';
import { Command } from 'commander';
import ora from 'ora';
import { getProfile } from '../config';
import { ApiClient } from '../api/client';
import { print, success, errorOut, OutputFormat } from '../output';
import { queryOption, queryParams } from '../resource';
import { paramsFor } from '../resources';

const ORDER_FIELDS = ['id', 'status', 'customer_id', 'date_created', 'total_inc_tax', 'currency_code', 'payment_method', 'items_total'];

function client(profile?: string): ApiClient {
  const p = getProfile(profile);
  return new ApiClient(p.storeHash, p.accessToken);
}

function parseInput(opts: { data?: string; file?: string }): unknown {
  if (opts.data) return JSON.parse(opts.data);
  if (opts.file) return JSON.parse(fs.readFileSync(opts.file, 'utf-8'));
  throw new Error('Provide --data <json> or --file <path>');
}

function addOpts(cmd: Command): Command {
  return cmd
    .option('-o, --output <format>', 'output format: json|table|pretty', 'pretty')
    .option('--profile <name>', 'credential profile');
}

export function registerOrders(program: Command): void {
  const orders = program.command('orders').description('Manage orders');

  addOpts(
    queryOption(
      orders
        .command('list')
        .description('List orders')
        .option('--status <status>', 'filter by status')
        .option('--page <n>', 'page number', '1')
        .option('--limit <n>', 'results per page (max 250)', '50')
        .option('--all', 'fetch all pages'),
      paramsFor('orders')
    )
  ).action(async (opts: { status?: string; page: string; limit: string; all?: boolean; query: Record<string, string>; output: OutputFormat; profile?: string }) => {
    const spinner = ora('Fetching orders...').start();
    try {
      const bc = client(opts.profile);
      const params: Record<string, unknown> = queryParams(opts, paramsFor('orders'));
      if (opts.status) params.status_id = opts.status;

      let data: unknown;
      if (opts.all) {
        data = await bc.getAllV2('orders', params);
      } else {
        data = await bc.get('v2', 'orders', { ...params, page: opts.page, limit: opts.limit });
      }

      spinner.stop();
      print(Array.isArray(data) ? data : [], opts.output, ORDER_FIELDS);
    } catch (e) {
      spinner.fail();
      errorOut((e as Error).message);
    }
  });

  addOpts(
    orders
      .command('get')
      .description('Get an order by ID')
      .argument('<id>', 'order ID')
  ).action(async (id: string, opts: { output: OutputFormat; profile?: string }) => {
    try {
      const bc = client(opts.profile);
      const data = await bc.get('v2', `orders/${id}`);
      print(data, opts.output);
    } catch (e) {
      errorOut((e as Error).message);
    }
  });

  addOpts(
    orders
      .command('update')
      .description('Update an order — status shortcut, or arbitrary fields via --data')
      .argument('<id>', 'order ID')
      .option('--status <status>', 'new status ID')
      .option('--data <json>', 'fields to update as JSON')
      .option('--file <path>', 'path to a JSON file')
  ).action(async (id: string, opts: { status?: string; data?: string; file?: string; output: OutputFormat; profile?: string }) => {
    const spinner = ora('Updating order...').start();
    try {
      const bc = client(opts.profile);
      const body: Record<string, unknown> = opts.data || opts.file
        ? parseInput(opts) as Record<string, unknown>
        : {};
      if (opts.status) body.status_id = opts.status;
      if (Object.keys(body).length === 0) {
        throw new Error('Nothing to update. Provide --status, --data, or --file.');
      }
      const data = await bc.put('v2', `orders/${id}`, body);
      spinner.stop();
      success(`Order ${id} updated`);
      print(data, opts.output);
    } catch (e) {
      spinner.fail();
      errorOut((e as Error).message);
    }
  });
}
