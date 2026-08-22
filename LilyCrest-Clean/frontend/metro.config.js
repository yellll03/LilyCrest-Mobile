const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Metro otherwise creates ten transformer processes on this 16-thread machine.
// Keeping the pool small prevents the workers from exhausting memory while the
// Android bundle is being built (especially after Metro has been open a while).
config.maxWorkers = 2;

config.resolver = {
  ...config.resolver,
  unstable_enablePackageExports: true,
};

module.exports = config;
