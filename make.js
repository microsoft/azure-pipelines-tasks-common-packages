const fs = require('node:fs');
const path = require('node:path');

const minimist = require('minimist');

const util = require('./common-npm-packages/build-scripts/util.js');

const ignoredFolders = ['build-scripts', '.git', '_download', 'node_modules'];
const defaultTestSuite = 'L0';
const predefinedFlags = {
    boolean: [
        'build',
        'test',
        'ci'
    ],
    string: [
        'suite',
        'packageName'
    ]
};

const options = minimist(process.argv, predefinedFlags)
const installCommand = options['ci'] ? 'npm ci' : 'npm install';
const testResultsPath = path.join(__dirname, 'test-results');
const mochaReporterPath = path.join(__dirname, 'common-npm-packages', 'build-scripts', 'junit-spec-reporter.js');
const coverageBaseNameJson = 'coverage-final.json';
const summaryBaseName = 'coverage-summary.json';

/**
 * Prints a label for the package or section being processed.
 * @param {string} name - The name of the package or section to print
 */
const printLabel = (name) => {
    console.log('\n----------------------------------');
    console.log(name);
    console.log('----------------------------------');
}

const installBuildScriptsDependencies = () => {
    console.log('Installing dependencies for BuildScripts');
    util.cd('common-npm-packages/build-scripts');
    util.run(installCommand);
    util.cd(__dirname);
}

const buildPsTestHelpers = () => {
    console.log('Building Tests');
    util.cd('Tests');
    util.run(installCommand);
    util.run(path.join('node_modules', '.bin', 'tsc'));
    util.cd(__dirname);
}

installBuildScriptsDependencies();

if (options['build']) {
    buildPsTestHelpers();

    console.log('\nBuilding shared npm packages');
    util.cd('common-npm-packages');
    const packageName = options['packageName'];

    fs.readdirSync('./', { encoding: 'utf-8' }).forEach(child => {
        if (fs.statSync(child).isDirectory() && !ignoredFolders.includes(child)) {
            if (packageName && child !== packageName) return;
            printLabel(child);

            util.cd(child);
            util.run(installCommand);
            const packageDefinition = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
            const buildScript = options['ci'] && packageDefinition.scripts?.['build:ci'] ? 'build:ci' : 'build';
            util.run(`npm run ${buildScript}`);
            util.cd('..');
        }
    });
}

if (options['test']) {
    const gitkeepName = '.gitkeep';
    const junitPath = path.join(testResultsPath, 'junit');
    const coveragePath = path.join(testResultsPath, 'coverage');
    process.env['SYSTEM_DEBUG'] = 'true';
    console.log('Testing shared npm packages');
    util.cd('common-npm-packages');
    const suite = options['suite'] || defaultTestSuite;
    const nycExecutableName = process.platform === 'win32' ? 'nyc.cmd' : 'nyc';
    const mochaExecutableName = process.platform === 'win32' ? 'mocha.cmd' : 'mocha';
    const rootNycPath = path.join(__dirname, 'node_modules', '.bin', nycExecutableName);
    const packageNycPath = options['packageName'] && path.join(__dirname, 'common-npm-packages', options['packageName'], 'node_modules', '.bin', nycExecutableName);
    const nycPath = [rootNycPath, packageNycPath].find(candidate => candidate && fs.existsSync(candidate)) || nycExecutableName;
    let testsFailed = false;
    util.cleanFolder(testResultsPath, [gitkeepName]);

    const startPath = process.cwd();

    fs.readdirSync(startPath, { encoding: 'utf-8' }).forEach(child => {
        if (fs.statSync(child).isDirectory() && !ignoredFolders.includes(child)) {
            if (options['packageName'] && child !== options['packageName']) return;
            printLabel(child);
            const buildPath = path.join(startPath, child, '_build');

            if (fs.existsSync(buildPath)) {
                const testPath = path.join(buildPath, 'Tests', `${suite}.js`);

                if (fs.existsSync(path.join(testPath))) {
                    try {
                        const suitName = `${child}-suite`;
                        const mochaOptions = util.createMochaOptions(mochaReporterPath, junitPath, suitName);
                        const packageNycPath = path.join(startPath, child, 'node_modules', '.bin', nycExecutableName);
                        const packageNyc = [rootNycPath, packageNycPath].find(candidate => candidate && fs.existsSync(candidate)) || nycExecutableName;
                        const rootMochaPath = path.join(__dirname, 'node_modules', '.bin', mochaExecutableName);
                        const packageMochaPath = path.join(startPath, child, 'node_modules', '.bin', mochaExecutableName);
                        const mochaPath = [rootMochaPath, packageMochaPath].find(candidate => candidate && fs.existsSync(candidate)) || mochaExecutableName;

                        util.run(`"${packageNyc}" --all --src ${buildPath} --report-dir ${coveragePath} "${mochaPath}" ${mochaOptions} ${testPath}`, true);
                        util.renameFile(coveragePath, coverageBaseNameJson, `${child}-coverage.json`);
                    } catch (err) {
                        testsFailed = true;
                    }
                } else {
                    console.log('No tests found for the package');
                }
            } else {
                throw new Error(`Package "${buildPath}" has not been built`);
            }
        }
    });

    try {
        util.rm(path.join(coveragePath, summaryBaseName));
        util.run(`"${nycPath}" merge ${coveragePath} ${path.join(testResultsPath, 'merged-coverage.json')}`, true);
        util.run(`"${nycPath}" report -t ${testResultsPath} --report-dir ${testResultsPath} --reporter=cobertura`, true);
    } catch (e) {
        console.log('Error while generating coverage report')
    }

    if (testsFailed) {
        throw new Error('Tests failed!');
    }
}