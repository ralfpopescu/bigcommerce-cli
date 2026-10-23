/**
 * Exit codes are part of the CLI's contract: scripts and agents branch on them
 * instead of parsing messages, so a code never changes meaning once shipped.
 */
export const EXIT = {
  ok: 0,
  unexpected: 1,
  usage: 2,
  auth: 3,
  notFound: 4,
  validation: 5,
  rateLimited: 6,
  blocked: 7,
  server: 8,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export interface ApiErrorDetails {
  status: number;
  title: string;
  /** Field-level detail exactly as BigCommerce sent it: an object for V3, an array for V2. */
  errors?: unknown;
  method: string;
  /** Store-relative path with no host, query string or credentials. */
  path: string;
  requestId?: string;
  retryAfterMs?: number;
}

/** A non-2xx answer from BigCommerce. */
export class ApiError extends Error {
  readonly details: ApiErrorDetails;

  constructor(details: ApiErrorDetails) {
    super(`${details.status}: ${details.title}`);
    this.details = details;
  }

  get exitCode(): ExitCode {
    const s = this.details.status;
    if (s === 401 || s === 403) return EXIT.auth;
    if (s === 404) return EXIT.notFound;
    if (s === 400 || s === 409 || s === 422) return EXIT.validation;
    if (s === 429) return EXIT.rateLimited;
    if (s >= 500) return EXIT.server;
    return EXIT.unexpected;
  }
}

/** A GraphQL response that came back 200 with an `errors` array. */
export class GraphQLError extends Error {
  readonly exitCode = EXIT.validation;

  constructor(readonly errors: { message: string; path?: unknown; extensions?: unknown }[], readonly endpoint: string) {
    super(errors.map(e => e.message).join('; '));
  }
}

/** Anything the CLI rejects itself, before or instead of calling the API. */
export class CliError extends Error {
  constructor(message: string, readonly exitCode: ExitCode = EXIT.unexpected) {
    super(message);
  }
}

export class UsageError extends CliError {
  constructor(message: string) {
    super(message, EXIT.usage);
  }
}

export function exitCodeOf(e: unknown): ExitCode {
  if (e instanceof ApiError || e instanceof GraphQLError || e instanceof CliError) return e.exitCode;
  return EXIT.unexpected;
}

/** The `{"error": …}` object written to stderr in json mode. */
export function errorJson(e: unknown): { error: Record<string, unknown> } {
  if (e instanceof ApiError) {
    const { status, title, errors, method, path, requestId, retryAfterMs } = e.details;
    const out: Record<string, unknown> = { status, title };
    if (errors !== undefined) out.errors = errors;
    out.method = method;
    out.path = path;
    if (requestId) out.requestId = requestId;
    if (retryAfterMs !== undefined) out.retryAfterMs = retryAfterMs;
    return { error: out };
  }
  if (e instanceof GraphQLError) {
    return { error: { type: 'graphql', title: e.errors[0]?.message ?? 'GraphQL error', errors: e.errors, endpoint: e.endpoint } };
  }
  const message = e instanceof Error ? e.message : String(e);
  return { error: { type: typeOf(exitCodeOf(e)), title: message } };
}

function typeOf(code: ExitCode): string {
  const entry = Object.entries(EXIT).find(([, v]) => v === code);
  return entry ? entry[0] : 'unexpected';
}

/** Field errors as readable lines: "price: must be a number". */
export function fieldErrorLines(errors: unknown): string[] {
  if (errors === undefined || errors === null) return [];
  if (Array.isArray(errors)) {
    return errors.map(item => {
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        if (typeof o.message === 'string') return o.message;
      }
      return typeof item === 'string' ? item : JSON.stringify(item);
    });
  }
  if (typeof errors === 'object') {
    return Object.entries(errors as Record<string, unknown>).map(([k, v]) =>
      `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
  return [String(errors)];
}
