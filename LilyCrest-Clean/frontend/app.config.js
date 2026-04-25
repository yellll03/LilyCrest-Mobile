const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';

module.exports = {
  expo: {
    name: 'LilyCrest',
    slug: 'frontend',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'frontend',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      config: {
        googleMapsApiKey: GOOGLE_MAPS_API_KEY,
      },
    },
    android: {
      package: 'com.lilycrest.lilycrestdorm',
      googleServicesFile: './google-services.json',
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
      'expo-dev-client',
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
    owner: 'leigh_23',
    extra: {
      router: {},
      eas: {
        projectId: '02393b94-dfb2-4544-a052-19ff85b0220f',
      },
    },
  },
};
