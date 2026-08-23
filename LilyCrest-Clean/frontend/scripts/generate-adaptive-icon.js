const { generateAdaptiveIcons } = require('../generate-icons');

generateAdaptiveIcons()
  .then(() => console.log('Generated LilyCrest diamond adaptive-icon assets.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
