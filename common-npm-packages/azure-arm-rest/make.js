var path = require('path');
var util = require('../build-scripts/util');

var buildPath = './_build'

var opensslLatestVersion = process.env.EnableOpenSSLVersion3_4_2;
var opensslDir;
var opensslUrl;
if (opensslLatestVersion) {
	opensslDir = 'openssl3.4.2';
	opensslUrl = 'https://vstsagenttools.blob.core.windows.net/tools/openssl/3.4.2/M262/openssl.zip';
} 
else {
	opensslDir = 'openssl3.4.0';
	opensslUrl = 'https://vstsagenttools.blob.core.windows.net/tools/openssl/3.4.0/M252/openssl.zip';
}

var fs = require('fs');
if (!fs.existsSync(path.join(__dirname, opensslDir))) {
	util.run(`node ../build-scripts/downloadArchive.js ${opensslUrl} ${opensslDir}`);
}
util.rm('-rf', buildPath)
util.run(path.join(__dirname, 'node_modules/.bin/tsc') + ' --outDir ' + buildPath);

util.cp(path.join(__dirname, 'package.json'), buildPath);
util.cp(path.join(__dirname, 'package-lock.json'), buildPath);
util.cp(path.join(__dirname, 'module.json'), buildPath);
util.cp(path.join('./Tests', 'package.json'), path.join(buildPath, 'Tests'));
util.cp(path.join('./Tests', 'package-lock.json'), path.join(buildPath, 'Tests'));
util.cp('-r', opensslDir, buildPath);
util.cp('-r', 'Strings', buildPath);
util.cp('-r', 'node_modules', buildPath);