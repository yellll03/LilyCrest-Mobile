const {
  ISOLATED_QA_PUBLIC_ENV,
  createIsolatedQaBuildEnvironment,
} = require('../../scripts/build-isolated-qa-android');

describe('isolated QA Android build environment', () => {
  it('pins the release bundle to loopback and the demo Firebase project', () => {
    expect(ISOLATED_QA_PUBLIC_ENV).toMatchObject({
      NODE_ENV: 'production',
      EXPO_PUBLIC_QA_LOCAL_RUNTIME: 'true',
      EXPO_PUBLIC_BACKEND_URL: 'http://127.0.0.1:5001',
      EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_URL: 'http://127.0.0.1:9099',
      EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'demo-lilycrest-qa',
    });
  });

  it('overrides inherited production values instead of trusting the shell', () => {
    const env = createIsolatedQaBuildEnvironment({
      EXPO_PUBLIC_QA_LOCAL_RUNTIME: 'false',
      EXPO_PUBLIC_BACKEND_URL: 'https://api.lilycrest.space',
      EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'production-project',
    });

    expect(env.EXPO_PUBLIC_QA_LOCAL_RUNTIME).toBe('true');
    expect(env.EXPO_PUBLIC_BACKEND_URL).toBe('http://127.0.0.1:5001');
    expect(env.EXPO_PUBLIC_FIREBASE_PROJECT_ID).toBe('demo-lilycrest-qa');
  });
});
