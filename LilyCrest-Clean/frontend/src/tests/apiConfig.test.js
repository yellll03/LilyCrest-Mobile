import {
  isLocalOrPrivateBackendUrl,
  resolveBackendUrl,
} from '../config/api';

describe('api config backend URL resolver', () => {
  const productionOptions = { isDevelopment: false };

  it('accepts the canonical LilyCrest API URL', () => {
    expect(resolveBackendUrl('https://api.lilycrest.space', productionOptions))
      .toBe('https://api.lilycrest.space');
  });

  it('does NOT rewrite the canonical host back to the retired mobile-api host', () => {
    // Regression guard for the pre-cutover blocker: api.lilycrest.space used to be
    // treated as disallowed and silently rewritten to mobile-api.lilycrest.space.
    expect(resolveBackendUrl('https://api.lilycrest.space', productionOptions))
      .not.toBe('https://mobile-api.lilycrest.space');
  });

  it('falls back to the canonical API URL when no host is configured', () => {
    expect(resolveBackendUrl('', productionOptions)).toBe('https://api.lilycrest.space');
    expect(resolveBackendUrl(undefined, productionOptions)).toBe('https://api.lilycrest.space');
  });

  it('rejects the retired mobile-api host even if explicitly configured, and falls back to the canonical API URL', () => {
    // Host lock: production resolution is an allowlist of exactly the
    // canonical API host, not a denylist of hosts we already know are bad.
    // The old rollback host must never be reachable again, even via a
    // misconfigured EXPO_PUBLIC_BACKEND_URL.
    expect(resolveBackendUrl('https://mobile-api.lilycrest.space', productionOptions))
      .toBe('https://api.lilycrest.space');
  });

  it.each([
    'http://localhost:8001',
    'http://127.0.0.1:8001',
    'http://0.0.0.0:8001',
    'http://10.0.2.2:8001',
    'http://10.1.2.3:8001',
    'http://172.16.0.1:8001',
    'http://172.31.255.255:8001',
    'http://192.168.1.20:8001',
  ])('rejects local/private backend URL in production: %s', (url) => {
    expect(() => resolveBackendUrl(url, productionOptions))
      .toThrow('Invalid production backend URL');
  });

  it('does not classify public IPv4 addresses as private backend URLs', () => {
    expect(isLocalOrPrivateBackendUrl('https://172.32.0.1')).toBe(false);
    expect(isLocalOrPrivateBackendUrl('https://8.8.8.8')).toBe(false);
  });

  it('preserves existing development behavior for local backend URLs', () => {
    expect(resolveBackendUrl('http://localhost:8001', { isDevelopment: true }))
      .toBe('http://localhost:8001');
  });

  it('rejects onrender.com and falls back to the canonical API URL', () => {
    expect(resolveBackendUrl('https://lilycrest-mobile.onrender.com', productionOptions))
      .toBe('https://api.lilycrest.space');
    expect(resolveBackendUrl('https://something.onrender.com', productionOptions))
      .toBe('https://api.lilycrest.space');
  });

  it('rejects trycloudflare.com and falls back to the canonical API URL', () => {
    expect(resolveBackendUrl('https://random-tunnel.trycloudflare.com', productionOptions))
      .toBe('https://api.lilycrest.space');
  });

  // Host lock regression guard: production resolution must be an allowlist of
  // exactly api.lilycrest.space. Every other historically-referenced host
  // (retired Render mobile backend, this repo's own Render service name,
  // ad-hoc tunnels) must always resolve back to the canonical host — never be
  // returned as-is — so nothing can silently fail over to a different host.
  it.each([
    'https://mobile-api.lilycrest.space',
    'https://lilycrest-mobile.onrender.com',
    'https://lilycrest-api.onrender.com',
    'https://something.onrender.com',
    'https://random-tunnel.trycloudflare.com',
    'https://api.lilycrest.space.evil.com',
  ])('never resolves %s as the production backend host', (url) => {
    expect(resolveBackendUrl(url, productionOptions)).toBe('https://api.lilycrest.space');
  });
});
