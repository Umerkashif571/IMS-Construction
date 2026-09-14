const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = __dirname;
const clientDir = path.join(repoRoot, 'client');
const serverDir = path.join(repoRoot, 'server');
const outputDir = path.join(repoRoot, '.vercel', 'output');

console.log('repoRoot:', repoRoot);
console.log('clientDir:', clientDir);
console.log('serverDir:', serverDir);
console.log('outputDir:', outputDir);
console.log('clientDir exists:', fs.existsSync(clientDir));
console.log('serverDir exists:', fs.existsSync(serverDir));

try {
  // Clean output directory
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true });
  }

  // 1. Build client
  console.log('Building client...');
  execSync('npm run build', { cwd: clientDir, stdio: 'inherit' });

  // 2. Copy client build to .vercel/output/static
  console.log('Copying client build to .vercel/output/static...');
  const clientDist = path.join(clientDir, 'dist');
  console.log('clientDist exists:', fs.existsSync(clientDist));
  const staticOutput = path.join(outputDir, 'static');
  fs.cpSync(clientDist, staticOutput, { recursive: true });

  // 3. Create serverless function for API
  console.log('Creating API function...');
  const funcDir = path.join(outputDir, 'functions', 'api', 'index.func');
  fs.mkdirSync(funcDir, { recursive: true });

  // Copy server source to function
  const serverSrc = path.join(serverDir, 'src');
  console.log('serverSrc exists:', fs.existsSync(serverSrc));
  const funcSrc = path.join(funcDir, 'src');
  fs.cpSync(serverSrc, funcSrc, { recursive: true });

  // Copy server package.json and dependencies
  fs.cpSync(path.join(serverDir, 'package.json'), path.join(funcDir, 'package.json'));
  fs.cpSync(path.join(repoRoot, 'package.json'), path.join(funcDir, 'package.json'));

  // Copy api/index.js as the entrypoint
  const apiIndex = path.join(repoRoot, 'api', 'index.js');
  console.log('apiIndex exists:', fs.existsSync(apiIndex));
  fs.cpSync(apiIndex, path.join(funcDir, 'index.js'));

  // Create .vc-config.json for the function
  const funcConfig = {
    runtime: 'nodejs24.x',
    handler: 'index.js',
    launcherType: 'Nodejs',
    shouldAddHelpers: true,
    env: process.env
  };
  fs.writeFileSync(path.join(funcDir, '.vc-config.json'), JSON.stringify(funcConfig, null, 2));

  // 4. Create routes manifest
  console.log('Creating routes manifest...');
  const routesManifest = {
    version: 1,
    routes: [
      { src: '/api/(.*)', dest: '/api/index' },
      { src: '/(.*)', dest: '/static/$1' }
    ]
  };
  fs.writeFileSync(path.join(outputDir, 'routes-manifest.json'), JSON.stringify(routesManifest, null, 2));

  // 5. Create build output config
  const buildOutputConfig = {
    version: 3,
    routes: [
      { src: '/api/(.*)', dest: '/api/index' },
      { handle: 'filesystem' },
      { src: '/(.*)', dest: '/static/$1' }
    ]
  };
  fs.writeFileSync(path.join(outputDir, 'config.json'), JSON.stringify(buildOutputConfig, null, 2));

  console.log('Build output created at .vercel/output');
  console.log('Static files:', fs.readdirSync(staticOutput).length);
  console.log('Function created at:', funcDir);
} catch (err) {
  console.error('BUILD ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
}