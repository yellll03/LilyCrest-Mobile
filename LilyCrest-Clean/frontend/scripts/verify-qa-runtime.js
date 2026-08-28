const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function requireLoopbackUrl(name) {
  const value = String(process.env[name] || '').trim();
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_) {
    throw new Error(`${name} must be a valid URL`);
  }
  if (parsed.protocol !== 'http:' || !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase()) || !parsed.port) {
    throw new Error(`${name} must be an HTTP loopback URL with an explicit port`);
  }
  return parsed.origin;
}

if (String(process.env.EXPO_PUBLIC_QA_LOCAL_RUNTIME || '').trim().toLowerCase() !== 'true') {
  throw new Error('EXPO_PUBLIC_QA_LOCAL_RUNTIME=true is required');
}
const backend = requireLoopbackUrl('EXPO_PUBLIC_BACKEND_URL');
const emulator = requireLoopbackUrl('EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_URL');
const projectId = String(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || '').trim();
if (!projectId.startsWith('demo-')) throw new Error('EXPO_PUBLIC_FIREBASE_PROJECT_ID must start with demo-');

console.log(`Isolated QA runtime contract OK: ${backend}, ${emulator}, ${projectId}.`);
