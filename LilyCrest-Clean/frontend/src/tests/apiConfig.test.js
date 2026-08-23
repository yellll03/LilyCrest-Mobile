import {
  isLocalOrPrivateBackendUrl,
  resolveBackendUrl,
  resolveDeploymentEnvironment,
} from '../config/api';

describe('api config backend URL resolver', () => {
  const productionOptions = { isDevelopment: false, environment: 'production' };
  const stagingOptions = { isDevelopment: false, environment: 'staging' };

  it('pins production to the canonical LilyCrest API URL', () => {
    expect(resolveBackendUrl('https://api.lilycrest.space', productionOptions))
      .toBe('https://api.lilycrest.space');
    expect(resolveBackendUrl('https://staging-api.lilycrest.space', productionOptions))
      .toBe('https://api.lilycrest.space');
  });

  it('uses production as the non-development default and development during dev', () => {
    expect(resolveDeploymentEnvironment('', { isDevelopment: false })).toBe('production');
    expect(resolveDeploymentEnvironment('', { isDevelopment: true })).toBe('development');
  });

  it('accepts a clearly named public HTTPS staging host', () => {
    expect(resolveBackendUrl('https://staging-api.lilycrest.space/', stagingOptions))
      .toBe('https://staging-api.lilycrest.space');
    expect(resolveBackendUrl('https://lilycrest-qa.onrender.com', stagingOptions))
      .toBe('https://lilycrest-qa.onrender.com');
  });

  it.each([
    '',
    'https://api.lilycrest.space',
    'https://lilycrest-mobile.onrender.com',
    'http://staging-api.lilycrest.space',
    'http://10.0.2.2:8001',
    'https://api.lilycrest.space.evil.com',
  ])('refuses an unsafe staging backend URL: %s', (url) => {
    expect(() => resolveBackendUrl(url, stagingOptions)).toThrow('Invalid staging backend URL');
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

  it('preserves local development URLs', () => {
    expect(resolveBackendUrl('http://localhost:8001', { isDevelopment: true, environment: 'development' }))
      .toBe('http://localhost:8001');
  });

  it.each([
    'https://mobile-api.lilycrest.space',
    'https://lilycrest-mobile.onrender.com',
    'https://lilycrest-api.onrender.com',
    'https://random-tunnel.trycloudflare.com',
  ])('never resolves %s as the production backend host', (url) => {
    expect(resolveBackendUrl(url, productionOptions)).toBe('https://api.lilycrest.space');
  });
});
