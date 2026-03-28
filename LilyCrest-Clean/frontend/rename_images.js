const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'assets', 'images');

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
  'Quad & double Common CR.jpg': 'common-restroom.jpg',
  'Quad & double Common CR2.jpg': 'shower-cubicles.jpg',
  'Private Rm T&B.JPG': 'private-bathroom.jpg',
};

for (const [old, nw] of Object.entries(renames)) {
  const src = path.join(dir, old);
  const dst = path.join(dir, nw);
  if (fs.existsSync(src)) {
    fs.renameSync(src, dst);
    console.log(`✓ ${old} -> ${nw}`);
  } else {
    console.log(`  skip: ${old} (not found)`);
  }
}
console.log('Done!');
