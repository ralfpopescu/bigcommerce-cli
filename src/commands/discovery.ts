import { Command, Option } from 'commander';
import { print, errorOut } from '../output';
import { runtime } from '../runtime';
import { getMeta, setMeta, commandPath, isMutating, HAND_WRITTEN } from '../meta';
import { CliError, EXIT } from '../errors';

export interface CommandEntry {
  command: string;
  description: string;
  arguments: { name: string; required: boolean; variadic: boolean }[];
  options: { flags: string; name: string; description: string; required: boolean; default?: unknown; takesValue: boolean }[];
  http?: { method: string; path: string };
  mutating: boolean | 'conditional';
  body: boolean;
  multipart: boolean;
}

function hasAction(cmd: Command): boolean {
  return Boolean((cmd as unknown as { _actionHandler?: unknown })._actionHandler);
}

/** Every runnable command, depth first, in registration order. */
export function leaves(root: Command): Command[] {
  const out: Command[] = [];
  const walk = (cmd: Command) => {
    if (cmd !== root && hasAction(cmd)) out.push(cmd);
    for (const sub of cmd.commands) walk(sub);
  };
  walk(root);
  return out;
}

function entry(cmd: Command): CommandEntry {
  const meta = getMeta(cmd);
  return {
    command: commandPath(cmd),
    description: cmd.description(),
    arguments: cmd.registeredArguments.map(a => ({ name: a.name(), required: a.required, variadic: a.variadic })),
    options: cmd.options.map((o: Option) => ({
      flags: o.flags,
      name: o.long ?? o.short ?? o.flags,
      description: o.description,
      required: Boolean(o.mandatory),
      ...(o.defaultValue !== undefined ? { default: o.defaultValue } : {}),
      takesValue: Boolean(o.required || o.optional),
    })),
    ...(meta?.http ? { http: meta.http } : {}),
    mutating: isMutating(meta) ?? false,
    body: Boolean(meta?.body),
    multipart: Boolean(meta?.multipart),
  };
}

function matches(e: CommandEntry, filter: string): boolean {
  const f = filter.toLowerCase();
  return [e.command, e.description, e.http?.path ?? ''].some(s => s.toLowerCase().includes(f));
}

/** Copies the HAND_WRITTEN table onto the commands it describes. */
export function annotateHandWritten(program: Command): void {
  for (const cmd of leaves(program)) {
    const meta = HAND_WRITTEN[commandPath(cmd)];
    if (meta) setMeta(cmd, meta);
  }
}

function findCommand(program: Command, words: string[]): Command | undefined {
  let cmd: Command | undefined = program;
  for (const w of words) {
    cmd = cmd?.commands.find(c => c.name() === w || c.aliases().includes(w));
    if (!cmd) return undefined;
  }
  return cmd;
}

/**
 * `bigc commands` and `bigc help … --json` let a program discover the CLI
 * without scraping --help text. Both read the live commander tree, so they
 * can't drift from what's actually registered.
 */
export function registerDiscovery(program: Command): void {
  program.helpCommand(false);

  program
    .command('commands')
    .description('List every command; --json gives a machine-readable catalog')
    .option('--json', 'print the catalog as JSON')
    .option('--filter <text>', 'only commands whose path, description or HTTP path contains this')
    .option('-o, --output <format>', 'output format: json|table|pretty')
    .action((opts: { json?: boolean; filter?: string }) => {
      const entries = leaves(program)
        .map(entry)
        .filter(e => !opts.filter || matches(e, opts.filter));
      if (opts.json || runtime.output === 'json') {
        print(entries, 'json');
        return;
      }
      const width = Math.max(...entries.map(e => e.command.length), 10);
      for (const e of entries) {
        const http = e.http ? `${e.http.method.padEnd(6)} ${e.http.path}` : '';
        runtime.printed = true;
        console.log(`${e.command.padEnd(width)}  ${http || e.description}`);
      }
    });

  program
    .command('help')
    .description('Show help for a command; --json gives its catalog entry')
    .argument('[command...]', 'command words, e.g. catalog products list')
    .option('--json', 'print the catalog entry as JSON')
    .action((words: string[], opts: { json?: boolean }) => {
      const cmd = findCommand(program, words);
      if (!cmd) errorOut(new CliError(`Unknown command: ${words.join(' ')}`, EXIT.usage));
      if (opts.json) {
        if (!hasAction(cmd)) {
          // A group, not a command: list what's under it instead.
          print(leaves(cmd).map(entry), 'json');
        } else {
          print(entry(cmd), 'json');
        }
        return;
      }
      cmd.outputHelp();
    });
}
