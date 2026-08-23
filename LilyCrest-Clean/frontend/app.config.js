const { execSync } = require('child_process');

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';
const DEPLOYMENT_ENVIRONMENT = String(process.env.EXPO_PUBLIC_DEPLOYMENT_ENV || 'development').trim().toLowerCase();
const IS_STAGING = DEPLOYMENT_ENVIRONMENT === 'staging';
const IS_DEVELOPMENT = DEPLOYMENT_ENVIRONMENT === 'development';
const APP_SCHEME = IS_STAGING ? 'lilycrest-staging' : IS_DEVELOPMENT ? 'lilycrest-dev' : 'frontend';
const GOOGLE_SERVICES_FILE = process.env.GOOGLE_SERVICES_JSON
  || `./android/app/src/${DEPLOYMENT_ENVIRONMENT}/google-services.json`;

if (!['development', 'staging', 'production'].includes(DEPLOYMENT_ENVIRONMENT)) {
  throw new Error(`Unsupported EXPO_PUBLIC_DEPLOYMENT_ENV: ${DEPLOYMENT_ENVIRONMENT}`);
}

// EAS build workers set these; a local `expo start`/`eas build` also has git
// available, so fall back to reading the checked-out commit directly. Only
// used for the Profile screen's build-info footer (frontend/app/(tabs)/profile.jsx)
// so a given APK can be traced back to the exact commit + moment it was built.
function resolveGitCommit() {
  if (process.env.EAS_BUILD_GIT_COMMIT_HASH) return process.env.EAS_BUILD_GIT_COMMIT_HASH.slice(0, 9);
  try {
    return execSync('git rev-parse --short HEAD', { cwd: process.cwd() }).toString().trim();
  } catch (_error) {
    return 'unknown';
  }
}

module.exports = {
  expo: {
    name: IS_STAGING ? 'LilyCrest STAGING' : IS_DEVELOPMENT ? 'LilyCrest DEV' : 'LilyCrest',
    slug: 'frontend',
    // Keep in sync with android/app/build.gradle's versionName — that file is
    // the authoritative source for native Android builds (this repo commits a
    // hand-maintained android/ folder rather than regenerating it from this
    // file via `expo prebuild` before every build). Bump both together.
    version: '1.2.2',
    orientation: 'default',
    icon: './assets/images/icon.png',
    scheme: APP_SCHEME,
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
      bundleIdentifier: IS_STAGING
        ? 'com.lilycrest.lilycrestdorm.staging'
        : IS_DEVELOPMENT
          ? 'com.lilycrest.lilycrestdorm.dev'
          : 'com.lilycrest.lilycrestdorm',
      supportsTablet: true,
      config: {
        googleMapsApiKey: GOOGLE_MAPS_API_KEY,
      },
    },
    android: {
      package: IS_STAGING
        ? 'com.lilycrest.lilycrestdorm.staging'
        : IS_DEVELOPMENT
          ? 'com.lilycrest.lilycrestdorm.dev'
          : 'com.lilycrest.lilycrestdorm',
      // Keep in sync with android/app/build.gradle's versionCode (see note above).
      versionCode: 21,
      googleServicesFile: GOOGLE_SERVICES_FILE,
      config: {
        googleSignIn: {
          apiKey: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_API_KEY || '',
          certificateHash: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CERT_HASH || '5e8f16062ea3cd2c4a0d547876baa6f38cabf625',
        },
        googleMaps: {
          apiKey: GOOGLE_MAPS_API_KEY,
        },
      },
      adaptiveIcon: {
        foregroundImage: './assets/images/adaptive-icon.png',
        backgroundColor: '#0A1628',
      },
      edgeToEdgeEnabled: false,
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: false,
          data: [{ scheme: APP_SCHEME }],
          category: ['DEFAULT', 'BROWSABLE'],
        },
      ],
    },
    web: {
      bundler: 'metro',
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      [
        'expo-dev-client',
        {
          launchMode: 'launcher',
        },
      ],
      [
        'expo-notifications',
        {
          defaultChannel: 'default',
          enableBackgroundRemoteNotifications: true,
        },
      ],
      'expo-secure-store',
      [
        'expo-splash-screen',
        {
          image: './assets/images/splash-image.png',
          imageWidth: 200,
          resizeMode: 'contain',
          backgroundColor: '#000000',
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    owner: 'ayagfdfgdgs-team',
    extra: {
      router: {},
      eas: {
        projectId: '02393b94-dfb2-4544-a052-19ff85b0220f',
      },
      gitCommit: resolveGitCommit(),
      buildTime: new Date().toISOString(),
      deploymentEnvironment: DEPLOYMENT_ENVIRONMENT,
    },
  },
};
