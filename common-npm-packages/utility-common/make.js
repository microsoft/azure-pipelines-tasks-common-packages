const path = require('path');
const fs = require('fs');

const util = require('../build-scripts/util');
const { downloadArchive } = require('../build-scripts/downloadArchive');

const buildPath = './_build';
const toolPath = './tools';
const zipUrl5 = 'https://vstsagenttools.blob.core.windows.net/tools/7zip/5/7zip.zip';
const zipUrl24 = 'https://vstsagenttools.blob.core.windows.net/tools/7zip/24.09/7zip.zip';

// Download and extract 7zip version 5
const targetPath5 = downloadArchive(zipUrl5, path.join('../_download', toolPath, '7zip5'));

if (!fs.existsSync(path.join(toolPath, '7zip5'))) {
    util.mkdir('-p', path.join(toolPath, '7zip5'));
}

util.cp('-rf', path.join(targetPath5, '*'), path.join(toolPath, '7zip5'));

// Download and extract 7zip version 24.09
const targetPath24 = downloadArchive(zipUrl24, path.join('../_download', toolPath, '7zip24'));

if (!fs.existsSync(path.join(toolPath, '7zip24'))) {
    util.mkdir('-p', path.join(toolPath, '7zip24'));
}

util.cp('-rf', path.join(targetPath24, '*'), path.join(toolPath, '7zip24'));

util.rm('-rf', buildPath)
util.run(path.join(__dirname, 'node_modules/.bin/tsc') + ' --outDir ' + buildPath);

util.cp(path.join(__dirname, 'package.json'), buildPath);
util.cp(path.join(__dirname, 'package-lock.json'), buildPath);
util.cp(path.join(__dirname, 'module.json'), buildPath);
util.cp('-r', 'tools', buildPath);
util.cp('-r', 'Strings', buildPath);
util.cp('-r', 'node_modules', buildPath);