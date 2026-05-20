const fs = require('fs');
const filePath = 'C:\\Users\\leigh\\Desktop\\LilyCrest\\LilyCrest-Clean\\backend\\controllers\\auth.controller.js';
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split(/\r?\n/);

console.log('Total lines:', lines.length);
console.log('Lines 168-178:');
for (let i = 167; i < 178 && i < lines.length; i++) {
  console.log(`  ${i+1}: ${JSON.stringify(lines[i])}`);
}

// Find and remove garbage lines between line 168 (resolvedUsername) and the updateOne call
// We want to keep: line 168 (resolvedUsername), then one blank, then the comment, then updateOne
const newLines = [];
let skipMode = false;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  // Skip the garbage regex fragment line
  if (line.startsWith('\\s+') || line === '\\s+/g, \'_\');') {
    console.log('Skipping garbage line ' + (i+1) + ': ' + JSON.stringify(lines[i]));
    continue;
  }
  // Remove duplicate comment (keep only the one right before await)
  if (line === '// Update profile with Google identity data — always use the Google email') {
    // Only keep it if the next non-empty line starts with 'await'
    let nextIdx = i + 1;
    while (nextIdx < lines.length && lines[nextIdx].trim() === '') nextIdx++;
    if (nextIdx < lines.length && lines[nextIdx].trim().startsWith('await')) {
      newLines.push(lines[i]);
    } else {
      console.log('Skipping duplicate comment at line ' + (i+1));
    }
    continue;
  }
  newLines.push(lines[i]);
}

// Remove excess blank lines between resolvedUsername and the comment
const result = newLines.join('\r\n');
fs.writeFileSync(filePath, result, 'utf8');
console.log('Fixed! New total lines:', newLines.length);
