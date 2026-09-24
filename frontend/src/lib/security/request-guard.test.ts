import { describe, expect, it } from 'vitest';
import { checkRequest, parseAllowedHosts, type GuardedRequest } from './request-guard';

const allowed = parseAllowedHosts(undefined);

function request(overrides: Partial<GuardedRequest> = {}): GuardedRequest {
  return { method: 'GET', pathname: '/library', host: 'localhost:4321', origin: null, ...overrides };
}

describe('parseAllowedHosts', () => {
  it('defaults to the loopback names on any port', () => {
    expect(allowed).toEqual(['localhost', '127.0.0.1', '[::1]']);
  });

  it('reads a comma-separated list, trimmed and lower-cased', () => {
    expect(parseAllowedHosts(' Books.example.com , 10.0.0.5:8080 ,')).toEqual(['books.example.com', '10.0.0.5:8080']);
  });
});

describe('checkRequest: Host (DNS rebinding)', () => {
  it.each(['localhost:4321', 'LOCALHOST:4400', '127.0.0.1', '[::1]:4321'])('lets %s through', (host) => {
    expect(checkRequest(request({ host }), allowed)).toBeNull();
  });

  it.each(['attacker.example:4321', 'localhost.attacker.example', '127.0.0.1.nip.io:4321', '', null])(
    'refuses the host %j',
    (host) => {
      expect(checkRequest(request({ host }), allowed)?.status).toBe(421);
    },
  );

  it('matches an entry with a port on that port only', () => {
    const list = parseAllowedHosts('books.example.com:8443');
    expect([
      checkRequest(request({ host: 'books.example.com:8443' }), list),
      checkRequest(request({ host: 'books.example.com:9999' }), list)?.status,
    ]).toEqual([null, 421]);
  });
});

describe('checkRequest: Origin on proxied writes', () => {
  const write = (origin: string | null, method = 'POST') => request({ method, pathname: '/api/notes', origin });

  it('accepts a write from the page’s own origin', () => {
    expect(checkRequest(write('http://localhost:4321'), allowed)).toBeNull();
  });

  it.each([
    ['another site', 'https://attacker.example'],
    ['the same host on another port', 'http://localhost:9999'],
    ['an opaque origin', 'null'],
    ['no Origin header', null],
  ])('refuses a write from %s', (_label, origin) => {
    expect(checkRequest(write(origin), allowed)?.status).toBe(403);
  });

  it('does not require an Origin on proxied reads or on page requests', () => {
    expect([
      checkRequest(request({ pathname: '/api/documents' }), allowed),
      checkRequest(request({ method: 'POST', pathname: '/library' }), allowed),
    ]).toEqual([null, null]);
  });
});
