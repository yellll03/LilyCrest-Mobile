/* eslint-env node */
// Delete image files with & in their names that crash metro's asset resolver
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'assets', 'images');

const files = fs.readdirSync(dir);
let deleted = 0;
for (const f of files) {
  if (f.includes('&')) {
    const full = path.join(dir, f);
    fs.unlinkSync(full);
    console.log('DELETED:', f);
    deleted++;
  }
}

// Also rename files with spaces to safe names (kebab-case)
const renames = {
  'Double sharing rm3.jpg': 'double-sharing-2.jpg',
  'Double sharing room1.jpg': 'double-sharing-1.jpg',
  'G_F elevator lobby.jpg': 'elevator-lobby.jpg',
  'G_F seating area.jpg': 'gf-seating-area.jpg',
  'G_F security counter.jpg': 'gf-security-counter.jpg',
  'Lounge common.jpg': 'lounge-common.jpg',
  'Pic quad.jpg': 'quad-room.jpg',
  'RD Lounge Area 2.jpg': 'rooftop-cafe.jpg',
  'RD Lounge Area.jpg': 'rooftop-lounge.jpg',
  'private room copy.jpg': 'private-room.jpg',
};

let renamed = 0;
for (const [old, nw] of Object.entries(renames)) {
  const src = path.join(dir, old);
  const dst = path.join(dir, nw);
  if (fs.existsSync(src)) {
    fs.renameSync(src, dst);
    console.log('RENAMED:', old, '->', nw);
    renamed++;
  }
}

console.log(`\nDone! Deleted ${deleted} files, renamed ${renamed} files.`);

// List remaining jpg files
const remaining = fs.readdirSync(dir).filter(f => f.match(/\.(jpg|jpeg|JPG)$/i));
console.log('\nRemaining JPG files:');
remaining.forEach(f => console.log('  ', f));
