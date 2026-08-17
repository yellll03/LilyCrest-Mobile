const { execSync } = require('child_process');

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';

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
    name: 'LilyCrest',
    slug: 'frontend',
    // Keep in sync with android/app/build.gradle's versionName — that file is
    // the authoritative source for native Android builds (this repo commits a
    // hand-maintained android/ folder rather than regenerating it from this
    // file via `expo prebuild` before every build). Bump both together.
    version: '1.1.10',
    orientation: 'default',
    icon: './assets/images/icon.png',
    scheme: 'frontend',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
      bundleIdentifier: 'com.lilycrest.lilycrestdorm',
      supportsTablet: true,
      config: {
        googleMapsApiKey: GOOGLE_MAPS_API_KEY,
      },
    },
    android: {
      package: 'com.lilycrest.lilycrestdorm',
      // Keep in sync with android/app/build.gradle's versionCode (see note above).
      versionCode: 12,
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON || './google-services.json',
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
        backgroundColor: '#000',
      },
      edgeToEdgeEnabled: false,
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: false,
          data: [{ scheme: 'frontend' }],
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
          backgroundColor: '#000',
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
    },
  },
};
