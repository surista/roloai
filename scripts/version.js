#!/usr/bin/env node
// Bumps the project version across root/mobile/web package.json.
// Format: MAJOR.MINOR.PATCH, with MINOR and PATCH zero-padded to 2 digits (e.g. 1.01.01).
// mobile/app.config.js reads this value directly at build time, so no separate sync step
// is needed there.

const fs = require('fs');
const path = require('path');

const bumpType = process.argv[2];

if (!['bug', 'minor', 'major'].includes(bumpType)) {
  console.error('Usage: node scripts/version.js [bug|minor|major]');
  console.error('  bug:   1.01.01 -> 1.01.02 (bug fixes)');
  console.error('  minor: 1.01.05 -> 1.02.01 (new features, backward compatible)');
  console.error('  major: 1.02.05 -> 2.01.01 (breaking changes)');
  process.exit(1);
}

const rootPackagePath = path.resolve(__dirname, '..', 'package.json');
const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8'));
const currentVersion = rootPackage.version;

const match = currentVersion.match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!match) {
  console.error(`Invalid version format: ${currentVersion}. Expected MAJOR.MINOR.PATCH`);
  process.exit(1);
}

let major = parseInt(match[1], 10);
let minor = parseInt(match[2], 10);
let patch = parseInt(match[3], 10);

switch (bumpType) {
  case 'major':
    major++;
    minor = 1;
    patch = 1;
    break;
  case 'minor':
    minor++;
    patch = 1;
    if (minor > 99) {
      major++;
      minor = 1;
    }
    break;
  case 'bug':
    patch++;
    if (patch > 99) {
      minor++;
      patch = 1;
    }
    if (minor > 99) {
      major++;
      minor = 1;
    }
    break;
}

const newVersion = `${major}.${String(minor).padStart(2, '0')}.${String(patch).padStart(2, '0')}`;

const targets = [
  rootPackagePath,
  path.resolve(__dirname, '..', 'mobile', 'package.json'),
  path.resolve(__dirname, '..', 'web', 'package.json'),
];

for (const targetPath of targets) {
  const pkg = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  pkg.version = newVersion;
  fs.writeFileSync(targetPath, JSON.stringify(pkg, null, 2) + '\n');
}

console.log(`Version bumped from v${currentVersion} to v${newVersion}`);
