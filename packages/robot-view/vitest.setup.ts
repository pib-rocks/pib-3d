import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const nativeFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (url.startsWith('file:')) {
    const path = fileURLToPath(url);
    if (!existsSync(path)) {
      return new Response(null, { status: 404, statusText: 'Not Found' });
    }
    const body = readFileSync(path);
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
  }
  return nativeFetch(input, init);
};
