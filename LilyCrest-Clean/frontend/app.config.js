const { resolveGitCommit } = require('./scripts/gitBuildIdentity');

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';

// Only used for the Profile screen's build-info footer
// (frontend/app/(tabs)/profile.jsx) so a given APK can be traced back to the
// exact commit + moment it was built — see scripts/gitBuildIdentity.js for
// the dirty-working-tree detection this wraps.

module.exports = {
  expo: {
    name: 'LilyCrest',
    slug: 'frontend',
    // Keep in sync with android/app/build.gradle's versionName — that file is
    // the authoritative source for native Android builds (this repo commits a
    // hand-maintained android/ folder rather than regenerating it from this
    // file via `expo prebuild` before every build). Bump both together.
    version: '1.2.2',
    orientation: 'default',
    icon: './assets/images/icon.png',
    scheme: 'frontend',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
      bundleIdentifier: 'com.lilycrest.lilycrestdorm',
      // Build 23 (commit d1d13c7e) already finished as a store-distribution
      // build — confirmed via `eas build:list --platform ios`. Reusing 23
      // would be rejected by App Store
      // Connect for a duplicate build number; Android's versionCode is
      // intentionally NOT bumped alongside this — the platforms have
      // legitimately independent build numbers.
      buildNumber: '24',
      supportsTablet: true,
      googleServicesFile: process.env.GOOGLE_SERVICES_PLIST || './GoogleService-Info.plist',
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
      config: {
        googleMapsApiKey: GOOGLE_MAPS_API_KEY,
      },
    },
    android: {
      package: 'com.lilycrest.lilycrestdorm',
      // Keep in sync with android/app/build.gradle's versionCode (see note above).
      versionCode: 21,
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
        backgroundColor: '#0A1628',
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
          // TestFlight/App Store builds must carry the production APNs
          // entitlement. The plugin defaults to development when omitted.
          mode: 'production',
        },
      ],
      'expo-secure-store',
      '@react-native-google-signin/google-signin',
      [
        'expo-build-properties',
        {
          ios: {
            extraPods: [
              { name: 'GoogleUtilities', modular_headers: true },
              { name: 'RecaptchaInterop', modular_headers: true },
            ],
          },
        },
      ],
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
    },
  },
};
