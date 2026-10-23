import type { OutputFormat } from './output';

/**
 * Per-invocation state that every layer needs but no layer should have to
 * thread through its arguments: the resolved output format decides how errors
 * are written, and the client consults the write guards before any request.
 */
export const runtime = {
  output: 'pretty' as OutputFormat,
  dryRun: false,
  /** Set once anything has gone to stdout, so json mode never prints a second document. */
  printed: false,
};
