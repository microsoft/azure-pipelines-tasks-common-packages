const path = require('path');

const util = require('../build-scripts/util');

const buildPath = './_build'

util.rm('-rf', buildPath)
util.run(path.join(__dirname, 'node_modules/.bin/tsc'));

util.cp(path.join(__dirname, 'package.json'), buildPath);
util.cp(path.join(__dirname, 'package-lock.json'), buildPath);
util.cp(path.join(__dirname, 'module.json'), buildPath);

// util.cp('-r', path.join(__dirname, 'Strings'), buildPath);
// util.cp('-r', 'Tests', buildPath);
util.cp('-r', path.join(__dirname, 'node_modules'), buildPath);

const downloadArchivePath = path.join(__dirname, '../build-scripts/downloadArchive.js');

const externalsPath = './externals';
const _7zrUrl = 'https://vstsagenttools.blob.core.windows.net/tools/7zr/1805_x86/7zr.zip';
util.run(`node ${downloadArchivePath} ${_7zrUrl} ${externalsPath}`);

util.cp('-r', externalsPath, buildPath);
