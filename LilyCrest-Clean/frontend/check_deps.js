const deps = [
  'react-native',
  'expo',
  'react-native-reanimated',
  'react-native-screens',
  'react-native-gesture-handler',
  'react-native-safe-area-context',
  'react-native-web',
  'react-native-webview',
  'react-native-worklets',
  '@react-native-async-storage/async-storage',
  '@react-native-google-signin/google-signin',
  'react',
  'react-dom',
];

console.log('=== Installed Dependency Versions ===\n');
for (const dep of deps) {
  try {
    const pkg = require(`./node_modules/${dep}/package.json`);
    const wanted = require('./package.json').dependencies[dep] || require('./package.json').devDependencies?.[dep] || '(not in package.json)';
    console.log(`${dep}: ${pkg.version} (wanted: ${wanted})`);
  } catch (e) {
    console.log(`${dep}: *** NOT INSTALLED ***`);
  }
}

// Check for peer dependency issues with react-native
console.log('\n=== React Native Peer Dep Check ===\n');
try {
  const rnPkg = require('./node_modules/react-native/package.json');
  const wantedReact = rnPkg.peerDependencies?.react;
  const installedReact = require('./node_modules/react/package.json').version;
  console.log(`react-native wants react: ${wantedReact}`);
  console.log(`installed react: ${installedReact}`);
} catch (e) {
  console.log('Could not check react-native peer deps:', e.message);
}

// Check react-native-web compat
try {
  const rnWebPkg = require('./node_modules/react-native-web/package.json');
  const wantedRN = rnWebPkg.peerDependencies?.['react-native'];
  const installedRN = require('./node_modules/react-native/package.json').version;
  console.log(`react-native-web wants react-native: ${wantedRN || 'any'}`);
  console.log(`installed react-native: ${installedRN}`);
} catch (e) {
  console.log('Could not check react-native-web peer deps:', e.message);
}
