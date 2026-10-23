import { Command } from 'commander';
import { print, errorOut, OutputFormat, progress } from '../output';
import { client, parseInput, addOpts } from '../shared';
import { queryOption, queryParams } from '../resource';
import { paramsFor } from '../resources';

const CHANNEL_FIELDS = ['id', 'type', 'platform', 'name', 'is_enabled', 'is_listable_from_ui', 'is_visible', 'status', 'date_created'];

export function registerChannels(program: Command): void {
  const channels = program.command('channels').description('Manage channels');

  addOpts(
    queryOption(
      channels
        .command('list')
        .description('List channels')
        .option('--all', 'fetch all pages'),
      paramsFor('channels')
    )
  ).action(async (opts: { all?: boolean; query: Record<string, string>; output: OutputFormat; profile?: string }) => {
    const spinner = progress('Fetching channels...').start();
    try {
      const bc = client(opts.profile);
      const filters = queryParams(opts, paramsFor('channels'));
      let data: unknown;
      if (opts.all) {
        data = await bc.getAllV3('channels', filters);
      } else {
        const res = await bc.get('v3', 'channels', filters) as { data: unknown[] };
        data = res.data;
      }
      spinner.stop();
      print(data, opts.output, CHANNEL_FIELDS);
    } catch (e) {
      spinner.fail();
      errorOut(e);
    }
  });

  addOpts(
    channels
      .command('get')
      .description('Get a channel by ID')
      .argument('<id>', 'channel ID')
  ).action(async (id: string, opts: { output: OutputFormat; profile?: string }) => {
    try {
      const bc = client(opts.profile);
      const res = await bc.get('v3', `channels/${id}`) as { data: unknown };
      print(res.data, opts.output);
    } catch (e) {
      errorOut(e);
    }
  });
}
