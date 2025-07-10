const ncp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');

const shell = require('shelljs');

const shellAssert = function () {
    const errMsg = shell.error();

    if (errMsg) {
        throw new Error(errMsg);
    }
}
/**
 * Function to run command line via child_process.execSync
 * @param {string} cl Command line to run
 * @param {boolean} [inheritStreams] - Inherit/pipe stdio streams
 * @param {boolean} [noHeader] - Don't print command line header
 * @returns
 */
const run = function (cl, inheritStreams, noHeader) {
    if (!noHeader) {
        console.log();
        console.log('> ' + cl);
    }

    try {
        return ncp.execSync(cl, {
            stdio: inheritStreams ? 'inherit' : 'pipe'
        })?.toString().trim();
    } catch (err) {
        if (!inheritStreams) {
            console.error(err.output ? err.output.toString() : err.message);
        }

        throw new Error(`Command '${cl}' failed`);
    }
}

exports.run = run;

/**
 * cd unix command via shelljs, with logging
 * change process.cwd() to dir
 * @param {String} dir - Directory path
 */
const cd = function (dir) {
    const cwd = process.cwd();

    if (cwd != dir) {
        console.log('');
        console.log(`> cd ${path.relative(cwd, dir)}`);
        shell.cd(dir);
        shellAssert();
    }
}
exports.cd = cd;

/**
 * mkdir unix command via shelljs
 * @param {String} options - Command options
 * @param {String} source - Source folder path
 * @param {String} [dest] - Destination folder path
 */
const cp = function (options, source, dest) {
    if (dest) {
        shell.cp(options, source, dest);
    } else {
        shell.cp(options, source);
    }

    shellAssert();
}
exports.cp = cp;

/**
 * mkdir unix command via shelljs
 * @param {String} options - Command options
 * @param {String} target - Destination path
 */
const mkdir = function (options, target) {
    if (target) {
        shell.mkdir(options, target);
    } else {
        shell.mkdir(options);
    }

    shellAssert();
}
exports.mkdir = mkdir;

/**
 * test unix command via shelljs
 * @param {shell.TestOptions} options - Command options
 * @param {String} p - Destination path
 * @returns
 */
const test = function (options, p) {
    const result = shell.test(options, p);
    shellAssert();
    return result;
}
exports.test = test;

/**
 * rm unix command via shelljs
 * @param {String} options - Command options
 * @param {String} [target] - Destination path
 */
const rm = function (options, target) {
    if (target) {
        shell.rm(options, target);
    } else {
        shell.rm(options);
    }

    shellAssert();
}
exports.rm = rm;

/**
 * Function to create mocha options, return empty string if params not passed
 * @param {String} reporterPath - Path/name to reporter
 * @param {String} baseOutput - Output folder
 * @param {String} reportName - Report name
 * @returns {String} - Mocha options
 */
const createMochaOptions = function (reporterPath, baseOutput, reportName) {
    if (!reporterPath || !baseOutput || !reportName) return '';
    const mochaFile = path.join(baseOutput, reportName + '.xml');
    return `-R ${reporterPath} -O mochaFile=${mochaFile}`
}
exports.createMochaOptions = createMochaOptions;

/**
 * Function to remove folder content
 * @param {String} folder - Path to folder
 * @param {string[]} excludedNames - Array of excluded names
 */
const cleanFolder = function (folder, excludedNames) {
    if (!fs.existsSync(folder)) return;

    const stack = [folder];
    const excluded = excludedNames || [];

    while (stack.length > 0) {
        const currentFolder = stack.pop();

        try {
            if (currentFolder === undefined) {
                throw new Error('Current folder is undefined');
            }

            const files = fs.readdirSync(currentFolder);

            if (files.length === 0) {
                fs.rmdirSync(currentFolder);
                continue;
            }

            files.forEach(file => {
                if (excluded.indexOf(file) === -1) {
                    const filePath = path.join(currentFolder, file);
                    const fileStat = fs.statSync(filePath);

                    if (fileStat.isDirectory()) {
                        stack.push(filePath);
                    } else {
                        fs.unlinkSync(filePath);
                    }
                }
            });
        } catch (err) {
            console.error(err);
        }
    }
}
exports.cleanFolder = cleanFolder;

/**
 * Function to rename file in folder
 * @param {String} folderPath - Path to folder
 * @param {String} oldName - Old file name
 * @param {String} newName - New file name
 * @returns void
 */
const renameFile = function (folderPath, oldName, newName) {
    try {
        if (!fs.existsSync(folderPath)) return;

        const oldFile = path.join(folderPath, oldName);
        const newFile = path.join(folderPath, newName);

        if (fs.existsSync(oldFile)) {
            fs.renameSync(oldFile, newFile);
        }
    } catch (e) {
        console.log(e)
    }
}
exports.renameFile = renameFile;

class CreateReleaseError extends Error {
    /**
     * CreateReleaseError constructor
     * @param {String} message - Error message
     */
    constructor(message) {
        super(message);

        this.name = 'CreateReleaseError';
        Error.captureStackTrace(this, CreateReleaseError)
    }
}

exports.CreateReleaseError = CreateReleaseError;

/**
 * @typedef {Object} PRDefinitionData
 * @property {string} merged_at - Date when the pull request was merged
 *
 * @typedef {Object} PRDefinition
 * @property {PRDefinitionData} pull_request - Pull request object
 * @property {string} title - Title of the pull request
 * @property {number} number - Pull request number
 * @property {boolean} packageExists - Flag indicating if the package exists
 */

/**
 * Function to form task changes from PRs
 * @param {PRDefinition[]} PRs - PRs to get the release notes for
 * @returns {string[]} - Object containing the task changes where key is a task and values - changes for the task
 */
function getChangesFromPRs(PRs) {
    /** @type {string[]} */
    const changes = [];

    PRs.forEach(PR => {
        if (!PR.packageExists) return;

        const closedDate = PR.pull_request.merged_at;
        const date = new Date(closedDate).toISOString().split('T')[0];
        changes.push(` - ${PR.title} (#${PR.number}) (${date})`);
    });

    return changes;
}
exports.getChangesFromPRs = getChangesFromPRs;

/**
 * Function to get current version of the package
 * @param {String} _package - Package name
 * @returns {String} - version of the package
 **/

function getCurrentPackageVersion(_package) {
    const packagePath = path.join(__dirname, '..', _package, 'package.json');

    if (!fs.existsSync(packagePath)) {
        throw new CreateReleaseError(`package.json for Package ${_package} not found.`)
    }

    const packageJson = require(packagePath);
    return packageJson.version;
}
exports.getCurrentPackageVersion = getCurrentPackageVersion;
