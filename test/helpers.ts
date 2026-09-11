import { Response } from 'node-fetch';
import { vi } from 'vitest';

import { FetchLike } from '../src/api/client';

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface FakeResponseInit {
  status?: number;
  body?: unknown;
  /** Raw text body, used to exercise the non-JSON path. */
  text?: string;
  headers?: Record<string, string>;
}

export function fakeResponse(init: FakeResponseInit = {}): Response {
  const status = init.status ?? 200;
  const headers = new Map(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const text = init.text ?? (init.body === undefined ? '' : JSON.stringify(init.body));

  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: statusTextFor(status),
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(JSON.parse(text)),
  } as unknown as Response;
}

function statusTextFor(status: number): string {
  const map: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    400: 'Bad Request',
    401: 'Unauthorized',
    404: 'Not Found',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
  };

  return map[status] ?? 'Unknown';
}

/**
 * A fetch double that replays a queue of responses and records what it was
 * asked for. The last response repeats once the queue is exhausted.
 */
export function fakeFetch(responses: Response[] | Response = fakeResponse()) {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const calls: RecordedCall[] = [];

  const impl: FetchLike = (url, init) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body,
    });

    const next = queue.length > 1 ? queue.shift() : queue[0];

    return Promise.resolve(next ?? fakeResponse());
  };

  return { fetch: vi.fn(impl) as unknown as FetchLike, calls };
}

/** Records sleeps instead of performing them, so retry tests are instant. */
export function fakeSleep() {
  const waits: number[] = [];

  return {
    sleep: (ms: number) => {
      waits.push(ms);

      return Promise.resolve();
    },
    waits,
  };
}
