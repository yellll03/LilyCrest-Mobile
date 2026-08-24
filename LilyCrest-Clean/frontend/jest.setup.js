/* eslint-env jest */
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

// Swipeable's behavior is covered by hook/source contracts in unit tests;
// native gesture dispatch itself is exercised by the Android build/device QA.
jest.mock('react-native-gesture-handler/Swipeable', () => {
  const React = require('react');
  const SwipeableMock = ({ children }) => React.createElement(React.Fragment, null, children);
  SwipeableMock.displayName = 'Swipeable';
  return SwipeableMock;
});

// The package root eagerly registers its native module (TurboModuleRegistry),
// which isn't present under jest-expo's mocked NativeModules shape above.
// Screens use gesture-handler's own TouchableOpacity (not react-native's)
// only for touchables nested inside a Swipeable, so onPress behavior is the
// same react-native Touchable under test; native gesture negotiation itself
// is exercised by the Android/iOS build/device QA.
jest.mock('react-native-gesture-handler', () => {
  const RN = require('react-native');
  return {
    TouchableOpacity: RN.TouchableOpacity,
    GestureHandlerRootView: RN.View,
  };
});

// expo-image's native view manager isn't registered under jest-expo's mocked
// NativeModules shape above, so requiring it directly throws. Render it as a
// thin wrapper around RN's own Image instead — good enough for behavioral
// tests (onLoad/onError/props all still fire) without needing the real
// native module.
jest.mock('expo-image', () => {
  const React = require('react');
  const { Image: RNImage } = require('react-native');
  const ExpoImageMock = React.forwardRef((props, ref) => React.createElement(RNImage, { ...props, ref }));
  ExpoImageMock.displayName = 'Image';
  return { Image: ExpoImageMock };
});
