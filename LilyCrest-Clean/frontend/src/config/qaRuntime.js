const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function parseLoopbackHttpUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch (_) {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (
    parsed.protocol !== 'http:'
    || !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
    || !parsed.port
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error(`${label} must be an HTTP loopback URL with an explicit port.`);
  }
  return parsed.origin;
}

export function resolveQaRuntime({ enabled, backendUrl, authEmulatorUrl, projectId }) {
  if (String(enabled || '').trim().toLowerCase() !== 'true') return null;
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId.startsWith('demo-')) {
    throw new Error('Local QA runtime requires a demo- Firebase project ID.');
  }
  return Object.freeze({
    backendUrl: parseLoopbackHttpUrl(backendUrl, 'Local QA backend'),
    authEmulatorUrl: parseLoopbackHttpUrl(authEmulatorUrl, 'Firebase Auth Emulator'),
    projectId: normalizedProjectId,
  });
}

export function resolveQaRuntimeFromEnv(env) {
  // Expo's release bundler replaces direct process.env.EXPO_PUBLIC_* access at
  // build time. Do not alias process.env here: an indirect `env.KEY` lookup
  // survives into the APK as undefined and silently disables the QA gate.
  const source = env || {
    EXPO_PUBLIC_QA_LOCAL_RUNTIME: process.env.EXPO_PUBLIC_QA_LOCAL_RUNTIME,
    EXPO_PUBLIC_BACKEND_URL: process.env.EXPO_PUBLIC_BACKEND_URL,
    EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_URL: process.env.EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_URL,
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  };
  return resolveQaRuntime({
    enabled: source.EXPO_PUBLIC_QA_LOCAL_RUNTIME,
    backendUrl: source.EXPO_PUBLIC_BACKEND_URL,
    authEmulatorUrl: source.EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_URL,
    projectId: source.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  });
}
