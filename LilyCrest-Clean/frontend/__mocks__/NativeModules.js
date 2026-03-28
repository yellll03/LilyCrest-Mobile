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

module.exports = {
  __esModule: true,
  default: nativeModulesMock,
  ...nativeModulesMock,
};
