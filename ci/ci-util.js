const ncp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

//------------------------------------------------------------------------------
// global paths
//------------------------------------------------------------------------------

const commonPackagesSourcePath = path.join(__dirname, '..', 'common-npm-packages');
exports.commonPackagesSourcePath = commonPackagesSourcePath;

//------------------------------------------------------------------------------
// generic functions
//------------------------------------------------------------------------------

/**
 * Parses the content of specified source folder and returns the top-level nested directories
 * @param {string} source - The path to the source directory
 * @returns {string[]} - The nested directories
 */
const getDirectories = source =>
  fs.readdirSync(source, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
exports.getDirectories = getDirectories;

/**
 * Executes the specified command in system shell and returns the stdout from the command
 * @param {string} cl - The name or path of the executable file to run
 * @param {boolean} [inheritStreams] - Configure the pipes that are established between the parent and child process. Default value: pipe
 * @returns {string} - The stdout from the command
 */
const run = function (cl, inheritStreams) {
    console.log('');
    console.log(`> ${cl}`);

    try {
        const output = ncp.execSync(cl, {
            stdio: inheritStreams ? 'inherit' : 'pipe'
        }).toString().trim();

        if (!inheritStreams) {
            console.log(output);
        }

        return output;
    } catch (err) {
        if (!inheritStreams) {
            console.error(err.output ? err.output.toString() : err.message);
        }

        throw new Error(`The following command line failed: '${cl}'`);
    }
}

exports.run = run;
