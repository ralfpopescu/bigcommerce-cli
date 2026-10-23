import * as fs from 'fs';
import { Command } from 'commander';
import { getIntrospectionQuery } from 'graphql';
import { print, success, errorOut, progress, OutputFormat } from '../output';
import { client, addOpts } from '../shared';
import { ApiClient, graphqlData, isGraphQLMutation } from '../api/client';
import { UsageError } from '../errors';
import { setMeta } from '../meta';
import { readQuery, readVariables } from './api';

const TOKEN_ENV = 'BIGC_STOREFRONT_TOKEN';

/** Minted tokens only need to outlive one command. */
const MINT_TTL_SECONDS = 60 * 60;

interface StorefrontOpts {
  domain?: string;
  channelId?: string;
  token?: string;
  mint?: boolean;
  customerId?: string;
  output: OutputFormat;
  profile?: string;
}

function graphqlUrl(host: string): string {
  const base = /^https?:\/\//.test(host) ? host : `https://${host}`;
  return `${base.replace(/\/+$/, '')}/graphql`;
}

/**
 * The storefront's /graphql. --domain wins; --channel-id looks up the
 * channel's site; otherwise the store's default channel, which always answers
 * on its canonical store-{hash} host.
 */
async function endpoint(bc: ApiClient, opts: StorefrontOpts): Promise<string> {
  if (opts.domain) return graphqlUrl(opts.domain);
  if (opts.channelId) {
    const res = await bc.get('v3', `channels/${opts.channelId}/site`) as { data?: { url?: string } };
    const url = res?.data?.url;
    if (!url) throw new UsageError(`Channel ${opts.channelId} has no site. Pass --domain <host> instead.`);
    return graphqlUrl(url);
  }
  return `https://store-${bc.store}.mybigcommerce.com/graphql`;
}

/**
 * Minting creates a short-lived token rather than changing store data, so it
 * is allowed in read-only mode and under --dry-run (mutating: false): a
 * read-only session still needs a token to read the storefront.
 *
 * Without a customer this mints a private token (server-to-server), not the
 * older CORS storefront token, which BigCommerce now restricts to browsers.
 * With --customer-id it mints a customer impersonation token.
 */
async function mint(bc: ApiClient, opts: StorefrontOpts): Promise<string> {
  const channelId = parseInt(opts.channelId ?? '1', 10);
  const expiresAt = Math.floor(Date.now() / 1000) + MINT_TTL_SECONDS;
  const [path, body] = opts.customerId
    ? ['v3/storefront/api-token-customer-impersonation', { channel_id: channelId, expires_at: expiresAt }]
    : ['v3/storefront/api-token-private', {
        channel_ids: [channelId],
        expires_at: expiresAt,
        scopes: ['Unauthenticated'],
        name: 'bigc cli (short-lived)',
      }];
  const res = await bc.request('POST', path, { body, mutating: false }) as { data?: { token?: string } };
  const token = res?.data?.token;
  if (!token) throw new Error('BigCommerce returned no token');
  return token;
}

async function token(bc: ApiClient, opts: StorefrontOpts): Promise<string> {
  const given = opts.token ?? process.env[TOKEN_ENV];
  if (given) return given;
  if (opts.mint) return mint(bc, opts);
  throw new UsageError(`Provide --token <token>, set ${TOKEN_ENV}, or pass --mint to create a short-lived one`);
}

async function run(bc: ApiClient, opts: StorefrontOpts, query: string, variables?: Record<string, unknown>): Promise<unknown> {
  if (opts.customerId !== undefined && !/^\d+$/.test(opts.customerId)) {
    throw new UsageError('--customer-id takes a numeric customer ID');
  }
  // Parse first: a broken document should fail before a token is minted.
  const mutating = isGraphQLMutation(query);
  const url = await endpoint(bc, opts);
  const bearer = await token(bc, opts);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${bearer}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (opts.customerId) headers['X-Bc-Customer-Id'] = opts.customerId;
  const res = await bc.external(url, { method: 'POST', headers, body: { query, variables }, mutating });
  return graphqlData(res, url);
}

function storefrontOpts(cmd: Command): Command {
  return cmd
    .option('--domain <host>', 'storefront host, e.g. shop.example.com (default: the store\'s canonical domain)')
    .option('--channel-id <id>', 'use this channel\'s site URL (and mint tokens for this channel)')
    .option('--token <token>', `storefront token (or set ${TOKEN_ENV})`)
    .option('--mint', 'create a short-lived token with the profile\'s credentials')
    .option('--customer-id <id>', 'act as this customer (impersonation token + X-Bc-Customer-Id)');
}

function writeSchema(out: string, data: unknown): void {
  fs.writeFileSync(out, JSON.stringify(data, null, 2));
  const types = (data as { __schema?: { types?: unknown[] } })?.__schema?.types?.length ?? 0;
  success(`Schema written to ${out} (${types} types)`, { file: out, types });
}

/** `bigc storefront graphql` — the GraphQL Storefront API, for Catalyst and headless work. */
export function registerStorefrontGraphql(program: Command): void {
  const storefront = program.commands.find(c => c.name() === 'storefront')
    ?? program.command('storefront').description('Storefront tokens, redirects, and template associations');

  const sfGraphql = addOpts(
    storefrontOpts(
      storefront
        .command('graphql')
        .description('Run a query against the GraphQL Storefront API')
        .option('--query <graphql>', 'the query or mutation')
        .option('--file <path>', 'path to a file holding the query')
        .option('--variables <json>', 'variables as JSON'),
    ),
    'json',
  );
  setMeta(sfGraphql, { http: { method: 'POST', path: 'https://{storefront}/graphql' }, mutating: 'conditional' });
  sfGraphql.action(async (opts: StorefrontOpts & { query?: string; file?: string; variables?: string }) => {
    const spinner = progress('Running storefront query...').start();
    try {
      const query = readQuery(opts);
      const variables = readVariables(opts.variables);
      const data = await run(client(opts.profile), opts, query, variables);
      spinner.stop();
      print(data, opts.output);
    } catch (e) {
      spinner.stop();
      errorOut(e);
    }
  });

  const sfSchema = addOpts(
    storefrontOpts(
      sfGraphql
        .command('schema')
        .description('Save the Storefront API schema (introspection result) to a file')
        .requiredOption('--out <file>', 'where to write the schema JSON'),
    ),
  );
  setMeta(sfSchema, { http: { method: 'POST', path: 'https://{storefront}/graphql' }, mutating: false });
  // The parent `graphql` command declares the same options, and commander
  // hands options to the parent when both know them — so read both levels.
  sfSchema.action(async (_opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals() as StorefrontOpts & { out: string };
    const spinner = progress('Fetching storefront schema...').start();
    try {
      const data = await run(client(opts.profile), opts, getIntrospectionQuery());
      spinner.stop();
      writeSchema(opts.out, data);
    } catch (e) {
      spinner.stop();
      errorOut(e);
    }
  });
}

/** `bigc graphql schema` — the Admin API counterpart. */
export function registerAdminGraphqlSchema(program: Command): void {
  const graphql = program.commands.find(c => c.name() === 'graphql');
  if (!graphql) return;
  const cmd = addOpts(
    graphql
      .command('schema')
      .description('Save the Admin GraphQL schema (introspection result) to a file')
      .requiredOption('--out <file>', 'where to write the schema JSON'),
  );
  setMeta(cmd, { http: { method: 'POST', path: '/graphql' }, mutating: false });
  cmd.action(async (_opts: unknown, self: Command) => {
    const opts = self.optsWithGlobals() as { out: string; profile?: string };
    const spinner = progress('Fetching admin schema...').start();
    try {
      const data = await client(opts.profile).graphql(getIntrospectionQuery());
      spinner.stop();
      writeSchema(opts.out, data);
    } catch (e) {
      spinner.stop();
      errorOut(e);
    }
  });
}
