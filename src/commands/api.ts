import * as fs from 'fs';
import { Command } from 'commander';
import { print, success, errorOut, progress, OutputFormat } from '../output';
import { client, parseInput, parseJsonFlag, addOpts } from '../shared';
import { UsageError } from '../errors';

// BIGC_PAYMENTS_URL, like BIGC_API_URL, exists only so tests can use a mock.
const PAYMENTS_HOST = `${process.env.BIGC_PAYMENTS_URL || 'https://payments.bigcommerce.com'}/stores`;

function pair(value: string, previous: Record<string, string>): Record<string, string> {
  const index = value.indexOf('=');
  if (index === -1) throw new UsageError(`Expected key=value, got "${value}"`);
  return { ...previous, [value.slice(0, index)]: value.slice(index + 1) };
}

/** Reads a GraphQL document from --query or --file. */
export function readQuery(opts: { query?: string; file?: string }): string {
  if (opts.query) return opts.query;
  if (opts.file) {
    if (!fs.existsSync(opts.file)) throw new UsageError(`--file: ${opts.file} not found`);
    return fs.readFileSync(opts.file, 'utf-8');
  }
  throw new UsageError('Provide --query <graphql> or --file <path>');
}

export function readVariables(text?: string): Record<string, unknown> | undefined {
  return text ? parseJsonFlag('--variables', text) as Record<string, unknown> : undefined;
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
      .option('--raw', 'print the response envelope instead of unwrapping { data }'),
    'json',
  ).action(async (
    method: string,
    pathname: string,
    opts: { data?: string; file?: string; query: Record<string, string>; raw?: boolean; output: OutputFormat; profile?: string },
  ) => {
    const verb = method.toUpperCase();
    const spinner = progress(`${verb} ${pathname}`).start();
    try {
      if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(verb)) {
        throw new UsageError(`Unsupported method "${method}". Use GET, POST, PUT, PATCH or DELETE.`);
      }
      const bc = client(opts.profile);
      const res = await bc.request(verb, pathname, {
        body: parseInput(opts, false),
        params: opts.query,
      });
      spinner.stop();

      if (res === null) {
        success(`${verb} ${pathname} — 204 No Content`, { status: 204 });
        return;
      }
      const unwrapped = !opts.raw && res && typeof res === 'object' && 'data' in res
        ? (res as { data: unknown }).data
        : res;
      print(unwrapped, opts.output);
    } catch (e) {
      spinner.stop();
      errorOut(e);
    }
  });

  addOpts(
    program
      .command('graphql')
      .description('Run a query against the Admin GraphQL API')
      .option('--query <graphql>', 'the query or mutation')
      .option('--file <path>', 'path to a file holding the query')
      .option('--variables <json>', 'variables as JSON'),
    'json',
  ).action(async (opts: { query?: string; file?: string; variables?: string; output: OutputFormat; profile?: string }) => {
    const spinner = progress('Running query...').start();
    try {
      const query = readQuery(opts);
      const variables = readVariables(opts.variables);
      const bc = client(opts.profile);
      const data = await bc.graphql(query, variables);
      spinner.stop();
      print(data, opts.output);
    } catch (e) {
      spinner.stop();
      errorOut(e);
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
    const spinner = progress('Processing payment...').start();
    try {
      const body = parseInput(opts);
      const bc = client(opts.profile);
      const payload = await bc.external(`${PAYMENTS_HOST}/${bc.store}/payments`, {
        method: 'POST',
        headers: {
          Authorization: `PAT ${opts.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.bc.v1+json',
        },
        body,
      });
      spinner.stop();
      const data = (payload as { data?: unknown } | null)?.data ?? payload;
      success('Payment processed');
      print(data, opts.output);
    } catch (e) {
      spinner.stop();
      errorOut(e);
    }
  });
}
