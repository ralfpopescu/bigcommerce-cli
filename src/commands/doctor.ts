import { Command } from 'commander';
import chalk from 'chalk';
import { getProfile, ResolvedProfile } from '../config';
import { ApiClient } from '../api/client';
import { print, errorOut, progress } from '../output';
import { runtime } from '../runtime';
import { addOpts } from '../shared';
import { ApiError, CliError, EXIT } from '../errors';
import { setMeta } from '../meta';

/**
 * One cheap GET per scope area. BigCommerce has no endpoint that lists a
 * token's scopes, so asking for one record from each area is the substitute.
 * Each path is covered by the scope named in the comment (per the API
 * accounts docs); a GET only proves the read half of a scope.
 */
const PROBES: Record<string, string> = {
  catalog: 'v3/catalog/products?limit=1', // Products
  orders: 'v2/orders?limit=1', // Orders
  customers: 'v3/customers?limit=1', // Customers
  content: 'v3/content/widgets?limit=1', // Content
  themes: 'v3/themes', // Themes
  channels: 'v3/channels?limit=1', // Channel Settings
  inventory: 'v3/inventory/locations?limit=1', // Store Inventory
  marketing: 'v2/coupons?limit=1', // Marketing
  settings: 'v3/settings/store/locale', // Information & Settings
  webhooks: 'v3/hooks?limit=1', // default scope, every API account has it
};

type ProbeResult = 'ok' | 'forbidden' | 'error';

const STORE_FIELDS = ['id', 'name', 'domain', 'secure_url', 'status', 'plan_name', 'plan_level', 'plan_is_trial', 'country', 'currency'];

async function probe(bc: ApiClient, path: string): Promise<{ result: ProbeResult; status?: number }> {
  try {
    await bc.request('GET', path);
    return { result: 'ok' };
  } catch (e) {
    if (e instanceof ApiError) {
      const s = e.details.status;
      return { result: s === 401 || s === 403 ? 'forbidden' : 'error', status: s };
    }
    return { result: 'error' };
  }
}

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]]));
}

export function registerDoctor(program: Command, version: string): void {
  const cmd = addOpts(
    program
      .command('doctor')
      .description('Check credentials, store, and which API areas the token can read'),
  );
  setMeta(cmd, { http: { method: 'GET', path: '/v2/store' } });
  cmd.action(async (opts: { profile?: string }) => {
    const spinner = progress('Checking...').start();
    let profile: ResolvedProfile;
    try {
      profile = getProfile(opts.profile);
    } catch (e) {
      spinner.stop();
      errorOut(e);
    }

    const bc = new ApiClient(profile.storeHash, profile.accessToken, { readOnly: profile.readOnly });
    const [storeRes, ...probeRes] = await Promise.all([
      bc.request('GET', 'v2/store').then(
        s => ({ ok: true as const, store: s as Record<string, unknown> }),
        (e: unknown) => ({ ok: false as const, error: e }),
      ),
      ...Object.values(PROBES).map(p => probe(bc, p)),
    ]);
    spinner.stop();

    const scopes = Object.fromEntries(Object.keys(PROBES).map((area, i) => [area, probeRes[i].result]));
    const report: Record<string, unknown> = {
      cli: { version },
      profile: {
        name: profile.source === 'profile' ? profile.name : null,
        source: profile.source,
        storeHash: profile.storeHash,
        readOnly: Boolean(profile.readOnly),
      },
      store: storeRes.ok
        ? pick(storeRes.store ?? {}, STORE_FIELDS)
        : { error: storeRes.error instanceof Error ? storeRes.error.message : String(storeRes.error) },
      scopes,
      scopeNote: 'Read access only: each area is probed with one GET. Write scopes are not checked.',
    };

    // Credentials that work nowhere are an auth failure, not a report.
    const storeAuthFailed = !storeRes.ok && storeRes.error instanceof ApiError && storeRes.error.exitCode === EXIT.auth;
    const everythingForbidden = Object.values(scopes).every(r => r === 'forbidden');
    if (storeAuthFailed && everythingForbidden) {
      if (runtime.output === 'json') print(report);
      errorOut(new CliError('The credentials were rejected everywhere (401/403). Check the store hash and access token.', EXIT.auth));
    }

    if (runtime.output === 'json') {
      print(report);
      return;
    }

    const line = (k: string, v: unknown) => console.log(`${chalk.cyan(k.padEnd(12))} ${v}`);
    runtime.printed = true;
    line('cli', version);
    line('profile', profile.source === 'profile' ? `${profile.name} (saved profile)` : 'BIGC_STORE_HASH / BIGC_TOKEN');
    line('store hash', profile.storeHash);
    line('read-only', profile.readOnly ? chalk.yellow('yes') : 'no');
    if (storeRes.ok) {
      const s = storeRes.store ?? {};
      line('store', `${s.name ?? '?'} — ${s.secure_url ?? s.domain ?? ''}`);
      if (s.plan_name) line('plan', s.plan_name);
    } else {
      line('store', chalk.red((report.store as { error: string }).error));
    }
    console.log(chalk.bold('\nRead access by area'));
    for (const [area, result] of Object.entries(scopes)) {
      const mark = result === 'ok' ? chalk.green('ok') : result === 'forbidden' ? chalk.yellow('forbidden') : chalk.red('error');
      console.log(`  ${area.padEnd(10)} ${mark}`);
    }
    console.log(chalk.gray('\nOnly read scopes are probed; write access is not checked.'));
  });
}
