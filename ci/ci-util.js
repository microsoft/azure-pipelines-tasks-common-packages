var ncp = require('child_process');
var fs = require("fs");
var path = require('path');

//------------------------------------------------------------------------------
// global paths
//------------------------------------------------------------------------------

var commonPackagesSourcePath = path.join(__dirname, '..', 'common-npm-packages');
exports.commonPackagesSourcePath = commonPackagesSourcePath;

//------------------------------------------------------------------------------
// generic functions
//------------------------------------------------------------------------------

var getDirectories = source =>
  fs.readdirSync(source, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
exports.getDirectories = getDirectories;

var run = function (cl, inheritStreams) {
    console.log('');
    console.log(`> ${cl}`);
    var options = {
        stdio: inheritStreams ? 'inherit' : 'pipe'
    };
    var rc = 0;
    var output;
    try {
        output = ncp.execSync(cl, options);
    }
    catch (err) {
        if (!inheritStreams) {
            console.error(err.output ? err.output.toString() : err.message);
        }

        throw new Error(`The following command line failed: '${cl}'`);
    }

    output = (output || '').toString().trim();
    if (!inheritStreams) {
        console.log(output);
    }

    return output;
}
exports.run = run;
