import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';

import { ApiClient } from '../../src/api/client';
import { fakeFetch, fakeResponse, fakeSleep } from '../helpers';

const BASE = 'https://api.example.test/stores';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bigc-multipart-'));
const imageFile = path.join(dir, 'pixel.png');

fs.writeFileSync(imageFile, Buffer.from('89504e470d0a1a0a', 'hex'));

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function makeClient(responses?: Parameters<typeof fakeFetch>[0]) {
  const http = fakeFetch(responses ?? fakeResponse({ body: { data: { id: 1 } } }));
  const clock = fakeSleep();
  const client = new ApiClient({
    storeHash: 'abc123',
    accessToken: 'token-xyz',
    baseUrl: BASE,
    fetch: http.fetch,
    sleep: clock.sleep,
  });

  return { client, calls: http.calls, waits: clock.waits };
}

describe('multipart uploads', () => {
  it('posts a form to the versioned resource URL', async () => {
    const { client, calls } = makeClient();

    await client.postMultipart('v3', 'catalog/products/1/images', {
      image_file: { filePath: imageFile },
    });

    expect(calls[0]?.url).toBe(`${BASE}/abc123/v3/catalog/products/1/images`);
    expect(calls[0]?.method).toBe('POST');
  });

  it('sets a multipart content type and keeps the auth token', async () => {
    const { client, calls } = makeClient();

    await client.postMultipart('v3', 'catalog/products/1/images', {
      image_file: { filePath: imageFile },
    });

    const headers = calls[0]?.headers ?? {};

    expect(headers['X-Auth-Token']).toBe('token-xyz');
    expect(String(headers['content-type'])).toContain('multipart/form-data');
  });

  it('does not send a JSON content type on an upload', async () => {
    const { client, calls } = makeClient();

    await client.postMultipart('v3', 'x', { image_file: { filePath: imageFile } });

    expect(calls[0]?.headers['Content-Type']).toBeUndefined();
  });

  it('supports PUT uploads', async () => {
    const { client, calls } = makeClient();

    await client.putMultipart('v3', 'catalog/brands/1/image', {
      image_file: { filePath: imageFile },
    });

    expect(calls[0]?.method).toBe('PUT');
  });

  it('uploads against a raw store path', async () => {
    const { client, calls } = makeClient();

    await client.requestMultipart('POST', 'v3/settings/logo/image', {
      image_file: { filePath: imageFile },
    });

    expect(calls[0]?.url).toBe(`${BASE}/abc123/v3/settings/logo/image`);
  });

  it('stringifies scalar fields and skips undefined ones', async () => {
    const { client, calls } = makeClient();

    // Scalars only, so the form has no file stream and can be buffered here.
    await client.postMultipart('v3', 'catalog/products/1/images', {
      is_thumbnail: true,
      sort_order: 2,
      description: undefined,
    });

    const form = calls[0]?.body as { getBuffer: () => Buffer };
    const body = form.getBuffer().toString('utf-8');

    expect(body).toContain('name="is_thumbnail"');
    expect(body).toContain('true');
    expect(body).toContain('name="sort_order"');
    expect(body).toContain('2');
    expect(body).not.toContain('description');
  });

  it('includes the file part when a filePath is given', async () => {
    const { client, calls } = makeClient();

    await client.postMultipart('v3', 'catalog/products/1/images', {
      image_file: { filePath: imageFile },
    });

    const form = calls[0]?.body as { getHeaders: () => Record<string, string> };

    expect(form.getHeaders()['content-type']).toContain('boundary=');
  });

  it('retries an upload after a 429', async () => {
    const { client, calls, waits } = makeClient([
      fakeResponse({ status: 429, headers: { 'X-Rate-Limit-Time-Reset-Ms': '800' } }),
      fakeResponse({ body: { data: { id: 1 } } }),
    ]);

    await client.postMultipart('v3', 'x', { image_file: { filePath: imageFile } });

    expect(calls).toHaveLength(2);
    expect(waits).toEqual([800]);
  });

  it('surfaces an upload error', async () => {
    const { client } = makeClient(fakeResponse({ status: 422, body: { title: 'Bad image' } }));

    await expect(
      client.postMultipart('v3', 'x', { image_file: { filePath: imageFile } }),
    ).rejects.toThrow('422: Bad image');
  });
});

describe('downloads', () => {
  function streamResponse(content: string, status = 200) {
    const { Readable } = require('stream') as typeof import('stream');

    return {
      status,
      ok: status >= 200 && status < 300,
      statusText: status === 200 ? 'OK' : 'Not Found',
      headers: { get: () => null },
      body: Readable.from([Buffer.from(content)]),
    } as never;
  }

  it('streams the response to disk', async () => {
    const out = path.join(dir, 'theme.zip');
    const { client, calls } = makeClient(streamResponse('zip-bytes'));

    await client.download('v3/themes/abc/actions/download', out);

    expect(calls[0]?.url).toBe(`${BASE}/abc123/v3/themes/abc/actions/download`);
    expect(fs.readFileSync(out, 'utf-8')).toBe('zip-bytes');
  });

  it('sends the auth header on a download', async () => {
    const { client, calls } = makeClient(streamResponse('x'));

    await client.download('v3/themes/abc', path.join(dir, 'a.zip'));

    expect(calls[0]?.headers['X-Auth-Token']).toBe('token-xyz');
  });

  it('throws without writing a file when the download fails', async () => {
    const out = path.join(dir, 'missing.zip');
    const { client } = makeClient(streamResponse('', 404));

    await expect(client.download('v3/themes/nope', out)).rejects.toThrow('404: Not Found');
    expect(fs.existsSync(out)).toBe(false);
  });
});
