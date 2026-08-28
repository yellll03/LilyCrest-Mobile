import { resolveQaRuntime } from '../config/qaRuntime';

describe('isolated local QA runtime contract', () => {
  const safe = {
    enabled: 'true',
    backendUrl: 'http://127.0.0.1:5001',
    authEmulatorUrl: 'http://127.0.0.1:9099',
    projectId: 'demo-lilycrest-qa',
  };

  it('is disabled unless explicitly opted in', () => {
    expect(resolveQaRuntime({ ...safe, enabled: '' })).toBeNull();
    expect(resolveQaRuntime({ ...safe, enabled: 'false' })).toBeNull();
  });

  it('accepts only the isolated loopback stack', () => {
    expect(resolveQaRuntime(safe)).toEqual({
      backendUrl: 'http://127.0.0.1:5001',
      authEmulatorUrl: 'http://127.0.0.1:9099',
      projectId: 'demo-lilycrest-qa',
    });
  });

  it.each([
    ['remote backend', { backendUrl: 'https://api.lilycrest.space' }],
    ['LAN backend', { backendUrl: 'http://192.168.1.5:5001' }],
    ['HTTPS emulator', { authEmulatorUrl: 'https://127.0.0.1:9099' }],
    ['remote emulator', { authEmulatorUrl: 'http://10.0.0.5:9099' }],
    ['real Firebase project', { projectId: 'dormitorymanagement-caps-572cf' }],
  ])('refuses %s', (_label, override) => {
    expect(() => resolveQaRuntime({ ...safe, ...override })).toThrow();
  });
});
