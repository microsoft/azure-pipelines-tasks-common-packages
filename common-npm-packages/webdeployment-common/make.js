var path = require('path');
var util = require('../build-scripts/util');

var buildPath = './_build'

util.rm('-rf', buildPath)
util.run(path.join(__dirname, 'node_modules/.bin/tsc') + ' --outDir ' + buildPath);

util.cp(path.join(__dirname, 'package.json'), buildPath);
util.cp(path.join(__dirname, 'package-lock.json'), buildPath);
util.cp(path.join(__dirname, 'module.json'), buildPath);
util.cp('-r', '7zip', buildPath);
util.cp('-r', '7zip24', buildPath);
util.cp('-r', 'ctt', buildPath);
util.cp('-r', 'MSDeploy', buildPath);
util.cp('-r', 'node_modules', buildPath);
util.cp('-r', 'Strings', buildPath);
util.cp('-r', 'WebConfigTemplates', buildPath);
util.cp('-r', 'Tests', buildPath);
util.rm('-rf', path.join(buildPath, 'Tests', 'L1ZipUtility'));
