const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const buildPath = path.join(__dirname, '_build');
const npmUserConfigPath = path.join(__dirname, '.npmrc');

if (fs.existsSync(buildPath)) {
  fs.rmSync(buildPath, { recursive: true, force: true });
}

fs.mkdirSync(buildPath, { recursive: true });

const ENTRIES_EXCLUDE = [
  path.basename(buildPath),
  '.npmrc',
  'E2ETests',
  'EngineTests',
  'IntegrationTests',
  'make.js',
  'node_modules',
  'PerfTests',
  'ProvidersTests',
  'StoreTests',
  'TestData'
];

fs.readdirSync(__dirname).forEach(entry => {
  if (ENTRIES_EXCLUDE.includes(entry)) return;

  const srcPath = path.join(__dirname, entry);
  const destPath = path.join(buildPath, entry);

  if (fs.lstatSync(srcPath).isDirectory()) {
    fs.cpSync(srcPath, destPath, { recursive: true, force: true });
  } else {
    fs.copyFileSync(srcPath, destPath);
  }
});

fs.copyFileSync(path.join(__dirname, 'tsconfig.json'), path.join(buildPath, 'tsconfig.json'));

cp.execSync(`npm install --omit=dev --userconfig "${npmUserConfigPath}"`, { stdio: 'inherit', cwd: buildPath });
cp.execSync('tsc -p tsconfig.json', { stdio: 'inherit', cwd: buildPath });