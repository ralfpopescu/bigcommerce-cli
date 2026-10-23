import * as fs from 'fs';
import { Command } from 'commander';
import { getProfile } from './config';
import { ApiClient } from './api/client';
import { UsageError } from './errors';

/** The plumbing every command file needs: a client, a JSON body, the common options. */

export function client(profile?: string): ApiClient {
  const p = getProfile(profile);
  return new ApiClient(p.storeHash, p.accessToken, { readOnly: p.readOnly });
}

/** Parses a JSON flag, naming the flag in the error so the caller knows what to fix. */
export function parseJsonFlag(flag: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new UsageError(`${flag} is not valid JSON: ${(e as Error).message}`);
  }
}

export function parseInput(opts: { data?: string; file?: string }, required = true): unknown {
  if (opts.data) return parseJsonFlag('--data', opts.data);
  if (opts.file) {
    if (!fs.existsSync(opts.file)) throw new UsageError(`--file: ${opts.file} not found`);
    return parseJsonFlag(`--file (${opts.file})`, fs.readFileSync(opts.file, 'utf-8'));
  }
  if (required) throw new UsageError('Provide --data <json> or --file <path>');
  return undefined;
}

/**
 * Commands whose output defaults to json even on a terminal — `api` and
 * `graphql`, where the response shape is arbitrary and a table rarely helps.
 */
export const jsonByDefault = new WeakSet<Command>();

export function addOpts(cmd: Command, fallback: 'pretty' | 'json' = 'pretty'): Command {
  if (fallback === 'json') jsonByDefault.add(cmd);
  // No commander default: the format is resolved in a preAction hook so the
  // BIGC_OUTPUT variable and TTY detection can take part.
  return cmd
    .option('-o, --output <format>', 'output format: json|table|pretty')
    .option('--profile <name>', 'credential profile');
}
