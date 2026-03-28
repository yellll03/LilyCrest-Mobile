const fs = require('fs');
const src = 'C:/Users/leigh/.gemini/antigravity/brain/4124c0ae-a327-47ea-b3e9-5e064c87d404/dorm_splash_screen_1774203241635.png';
const dst = 'c:/Users/leigh/Desktop/LilyCrest/LilyCrest-Clean/frontend/assets/images/splash-image.png';

try {
  const oldSize = fs.statSync(dst).size;
  fs.copyFileSync(src, dst);
  const newSize = fs.statSync(dst).size;
  console.log(`OLD size: ${oldSize} bytes`);
  console.log(`NEW size: ${newSize} bytes`);
  console.log('SPLASH IMAGE REPLACED SUCCESSFULLY');
} catch (err) {
  console.error('ERROR:', err.message);
}
