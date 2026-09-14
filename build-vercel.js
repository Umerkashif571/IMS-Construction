const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Building client...');
execSync('npm run build', { cwd: path.join(__dirname, 'client'), stdio: 'inherit' });

console.log('Copying client/dist to server/public...');
const src = path.join(__dirname, 'client', 'dist');
const dest = path.join(__dirname, 'server', 'public');
fs.cpSync(src, dest, { recursive: true });
console.log('Done!');