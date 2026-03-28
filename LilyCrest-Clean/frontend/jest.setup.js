const mockAsyncStorage = require('@react-native-async-storage/async-storage/jest/async-storage-mock');

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

const nativeModulesMock = {
  UIManager: {
    ViewManagerAdapter_1: {},
    RCTView: {},
    viewManagerNames: [],
  },
  NativeUnimoduleProxy: {
    viewManagersMetadata: {},
  },
};

// Provide minimal NativeModules shape so jest-expo setup can attach view managers
jest.mock('react-native/Libraries/BatchedBridge/NativeModules', () => ({
  __esModule: true,
  default: nativeModulesMock,
  ...nativeModulesMock,
}));

// Mock expo pickers to avoid native EventEmitter wiring in tests
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  MediaTypeOptions: { All: 'All' },
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}));
