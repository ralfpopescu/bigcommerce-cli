import * as fs from 'fs';
import { Command } from 'commander';
import ora from 'ora';
import fetch from 'node-fetch';
import { getProfile } from '../config';
import { ApiClient } from '../api/client';
import { print, success, errorOut, OutputFormat } from '../output';

const PAYMENTS_HOST = 'https://payments.bigcommerce.com/stores';

function client(profile?: string): ApiClient {
  const p = getProfile(profile);
  return new ApiClient(p.storeHash, p.accessToken);
}

function parseInput(opts: { data?: string; file?: string }): unknown {
  if (opts.data) return JSON.parse(opts.data);
  if (opts.file) return JSON.parse(fs.readFileSync(opts.file, 'utf-8'));
  return undefined;
}

function pair(value: string, previous: Record<string, string>): Record<string, string> {
  const index = value.indexOf('=');
  if (index === -1) throw new Error(`Expected key=value, got "${value}"`);
  return { ...previous, [value.slice(0, index)]: value.slice(index + 1) };
}

function addOpts(cmd: Command): Command {
  return cmd
    .option('-o, --output <format>', 'output format: json|table|pretty', 'json')
    .option('--profile <name>', 'credential profile');
}

export function registerApi(program: Command): void {
  addOpts(
    program
      .command('api')
      .description('Call any store endpoint directly — the escape hatch for anything not yet wrapped')
      .argument('<method>', 'HTTP method: GET, POST, PUT, DELETE')
      .argument('<path>', 'store path, e.g. /v3/catalog/products or v2/orders/123')
      .option('--data <json>', 'request body as JSON')
      .option('--file <path>', 'path to a JSON file to send as the body')
      .option('--query <k=v>', 'query parameter (repeatable)', pair, {} as Record<string, string>)
      .option('--raw', 'print the response envelope instead of unwrapping { data }')
  ).action(async (
    method: string,
    pathname: string,
    opts: { data?: string; file?: string; query: Record<string, string>; raw?: boolean; output: OutputFormat; profile?: string },
  ) => {
    const spinner = ora(`${method.toUpperCase()} ${pathname}`).start();
    try {
      const bc = client(opts.profile);
      const res = await bc.request(method.toUpperCase(), pathname, {
        body: parseInput(opts),
        params: opts.query,
      });
      spinner.stop();

      if (res === null) {
        success(`${method.toUpperCase()} ${pathname} — 204 No Content`);
        return;
      }
      const unwrapped = !opts.raw && res && typeof res === 'object' && 'data' in res
        ? (res as { data: unknown }).data
        : res;
      print(unwrapped, opts.output);
    } catch (e) {
      spinner.stop();
      errorOut((e as Error).message);
    }
  });

  addOpts(
    program
      .command('graphql')
      .description('Run a query against the Admin GraphQL API')
      .option('--query <graphql>', 'the query or mutation')
      .option('--file <path>', 'path to a file holding the query')
      .option('--variables <json>', 'variables as JSON')
  ).action(async (opts: { query?: string; file?: string; variables?: string; output: OutputFormat; profile?: string }) => {
    const spinner = ora('Running query...').start();
    try {
      const query = opts.query ?? (opts.file ? fs.readFileSync(opts.file, 'utf-8') : undefined);
      if (!query) throw new Error('Provide --query <graphql> or --file <path>');

      const bc = client(opts.profile);
      const res = await bc.graphql(query, opts.variables ? JSON.parse(opts.variables) : undefined) as {
        data?: unknown;
        errors?: { message: string }[];
      };
      spinner.stop();

      if (res.errors?.length) {
        errorOut(res.errors.map(e => e.message).join('; '));
      }
      print(res.data, opts.output);
    } catch (e) {
      spinner.stop();
      errorOut((e as Error).message);
    }
  });
}

/**
 * Payment processing is the one endpoint that lives off the REST host: it goes
 * to payments.bigcommerce.com and authenticates with a Payment Access Token
 * rather than the store's X-Auth-Token.
 */
export function registerPaymentProcessing(payments: Command): void {
  addOpts(
    payments
      .command('process')
      .description('Charge a payment instrument (payments.bigcommerce.com, PAT auth)')
      .requiredOption('--token <pat>', 'Payment Access Token from `bigc payments access-token`')
      .option('--data <json>', 'payment request as JSON')
      .option('--file <path>', 'path to a JSON file')
  ).action(async (opts: { token: string; data?: string; file?: string; output: OutputFormat; profile?: string }) => {
    const spinner = ora('Processing payment...').start();
    try {
      const body = parseInput(opts);
      if (body === undefined) throw new Error('Provide --data <json> or --file <path>');

      const { storeHash } = getProfile(opts.profile);
      const res = await fetch(`${PAYMENTS_HOST}/${storeHash}/payments`, {
        method: 'POST',
        headers: {
          Authorization: `PAT ${opts.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.bc.v1+json',
        },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      spinner.stop();

      if (!res.ok) {
        const d = payload as { title?: string; errors?: unknown };
        throw new Error(`${res.status}: ${d?.title ?? JSON.stringify(d?.errors ?? payload)}`);
      }
      const data = (payload as { data?: unknown }).data ?? payload;
      success('Payment processed');
      print(data, opts.output);
    } catch (e) {
      spinner.stop();
      errorOut((e as Error).message);
    }
  });
}
