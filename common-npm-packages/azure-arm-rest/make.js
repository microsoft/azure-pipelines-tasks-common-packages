const fs = require('fs');
const path = require('path');

const util = require('../build-scripts/util');
const { downloadArchive } = require('../build-scripts/downloadArchive');

const buildPath = path.join(__dirname, './_build');
const openSSLUrls = {
    'openssl3.6.1': 'https://vstsagenttools.blob.core.windows.net/tools/openssl/3.6.1/M271/openssl.zip',
    'openssl3.4.2': 'https://vstsagenttools.blob.core.windows.net/tools/openssl/3.4.2/M262/openssl.zip'
};

util.rm('-rf', buildPath);
util.run(path.join(__dirname, 'node_modules/.bin/tsc') + ' --outDir ' + buildPath);

util.cp(path.join(__dirname, 'package.json'), buildPath);
util.cp(path.join(__dirname, 'package-lock.json'), buildPath);
util.cp(path.join(__dirname, 'module.json'), buildPath);
util.cp(path.join('./Tests', 'package.json'), path.join(buildPath, 'Tests'));
util.cp(path.join('./Tests', 'package-lock.json'), path.join(buildPath, 'Tests'));

for (const version in openSSLUrls) {
    const openSSLDirectoryPath = path.join(__dirname, '_download', version);
    const opensslUrl = openSSLUrls[version];
    const targetPath = downloadArchive(opensslUrl, openSSLDirectoryPath);
    util.mkdir(path.join(buildPath, version));
    util.cp('-r', path.join(targetPath, '*'), path.join(buildPath, version));
}

util.cp('-r', 'Strings', buildPath);
util.cp('-r', 'node_modules', buildPath);