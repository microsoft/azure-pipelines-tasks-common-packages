const { existsSync } = require('node:fs');
const { join } = require('node:path');

const util = require('../build-scripts/util');
const { downloadArchive } = require('../build-scripts/downloadArchive');

const buildPath = './_build';
const toolPath = './tools';

const zipUrls = {
    '7zip24': 'https://vstsagenttools.blob.core.windows.net/tools/7zip/24.09/7zip.zip',
    '7zip25': 'https://vstsagenttools.blob.core.windows.net/tools/7zip/25.01/7zip.zip'
};

for (const [version, url] of Object.entries(zipUrls)) {
    const targetPath = join(toolPath, version);
    const sourcePath = downloadArchive(url, join('../_download', targetPath));

    if (!existsSync(targetPath)) {
        util.mkdir('-p', targetPath);
    }

    util.cp('-rf', join(sourcePath, '*'), targetPath);
}

util.rm('-rf', buildPath)
util.run(join(__dirname, 'node_modules/.bin/tsc') + ' --outDir ' + buildPath);

util.cp(join(__dirname, 'package.json'), buildPath);
util.cp(join(__dirname, 'package-lock.json'), buildPath);
util.cp(join(__dirname, 'module.json'), buildPath);
util.cp('-r', 'tools', buildPath);
util.cp('-r', 'Strings', buildPath);
util.cp('-r', 'node_modules', buildPath);