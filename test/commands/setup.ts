import { Command } from 'commander';
import { vi } from 'vitest';

/** The client double every command test drives. */
export const client = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  request: vi.fn(),
  postMultipart: vi.fn(),
  putMultipart: vi.fn(),
  requestMultipart: vi.fn(),
  graphql: vi.fn(),
  download: vi.fn(),
  getAllV3: vi.fn(),
  getAllV2: vi.fn(),
};

export const printed: unknown[] = [];
export const succeeded: string[] = [];

export function resetClient(): void {
  vi.clearAllMocks();
  printed.length = 0;
  succeeded.length = 0;
  client.get.mockResolvedValue({ data: [] });
  client.post.mockResolvedValue({ data: {} });
  client.put.mockResolvedValue({ data: {} });
  client.del.mockResolvedValue(null);
  client.request.mockResolvedValue({ data: {} });
  client.postMultipart.mockResolvedValue({ data: {} });
  client.putMultipart.mockResolvedValue({ data: {} });
  client.requestMultipart.mockResolvedValue({ data: {} });
  client.graphql.mockResolvedValue({ data: {} });
  client.download.mockResolvedValue(undefined);
  client.getAllV3.mockResolvedValue([]);
  client.getAllV2.mockResolvedValue([]);
}

export function run(program: Command, argv: string[]): Promise<unknown> {
  return program.parseAsync(['node', 'bigc', ...argv]);
}

/** A spinner double covering the whole ora surface these commands touch. */
export function fakeOra() {
  const spinner = {
    text: '',
    start: vi.fn(() => spinner),
    stop: vi.fn(() => spinner),
    succeed: vi.fn(() => spinner),
    fail: vi.fn(() => spinner),
    warn: vi.fn(() => spinner),
    info: vi.fn(() => spinner),
    clear: vi.fn(() => spinner),
  };

  return spinner;
}
