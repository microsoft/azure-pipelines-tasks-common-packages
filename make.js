const fs = require('fs');
const path = require('path');
const util = require('./common-npm-packages/build-scripts/util');
const minimist = require('minimist');

const ignoredFolders = ['build-scripts', '.git', '_download', 'node_modules'];
const defaultTestSuite = 'L0';
const predefinedFlags = {
    boolean: [
        'build',
        'test'
    ],
    string: [
        'suite'
    ]
};

const dirname = __dirname;

const options = minimist(process.argv, predefinedFlags)

const printLabel = (name) => {
    console.log('\n----------------------------------');
    console.log(name);
    console.log('----------------------------------');
}

if (options.build) {
    console.log('Building shared npm packages');
    util.cd('common-npm-packages');
    fs.readdirSync('./', { encoding: 'utf-8' }).forEach(child => {
        if (fs.statSync(child).isDirectory() && !ignoredFolders.includes(child)) {
            printLabel(child);

            util.cd(child);
            // util.run('npm install');
            util.run('npm run build');
            util.cd('..');
        }
    });
}

if (options.test) {
    console.log('Testing shared npm packages');
    util.cd('common-npm-packages');
    const suite = options.suite || defaultTestSuite;
    let testsFailed = false;
    cleanJunitFolder();

    fs.readdirSync('./', { encoding: 'utf-8' }).forEach(child => {
        if (fs.statSync(child).isDirectory() && !ignoredFolders.includes(child)) {
            printLabel(child);

            if (fs.existsSync(path.join('./', child, '_build'))) {
                util.cd(path.join(child, '_build'));

                if (fs.existsSync(path.join('./', 'Tests', `${suite}.js`))) {
                    try {
                        util.run(`nyc --reporter=cobertura mocha Tests/${suite}.js --reporter cypress-multi-reporters --reporter-options configFile=${dirname}${path.sep}reporterConfig.js`, true);
                        changeIstanbulOutput(dirname, process.cwd(), child);
                    } catch (err) {
                        testsFailed = true;
                    } finally {
                        util.cd('../..');
                    }
                } else {
                    console.log('No tests found for the package');
                    util.cd('../..');
                }
            } else {
                throw new Error('Package has not been built');
            }
        }
    });
    if (testsFailed) {
        throw new Error('Tests failed!');
    }
}

function cleanJunitFolder() {
    const junitFolder = path.join('./', dirname, 'junit');
    if (fs.existsSync(junitFolder)) {
        fs.readdirSync(junitFolder).forEach((file, index) => {
            const curPath = path.join(junitFolder, file);
            if (curPath.indexOf('.xml') >= 0){
                // delete file
                fs.unlinkSync(curPath);
            }
        });
    }
}

function changeIstanbulOutput(scriptDirectory, buildDirectory, testName) {
    if (!buildDirectory || !scriptDirectory) return;
    const coverageDir = path.join('./', buildDirectory, 'coverage');
    try {
        if (fs.existsSync(coverageDir)) {
            if (fs.existsSync(path.join('./', coverageDir, "cobertura-coverage.xml"))) {
                fs.renameSync(path.join('./', coverageDir, "cobertura-coverage.xml"), path.join(scriptDirectory, 'junit', `${testName}-coverage.xml`));
                deleteFolderRecursive(coverageDir);
                deleteFolderRecursive('.nyc_output');
            }
        }
    } catch (e) {
        console.log(e)
    }
}

function deleteFolderRecursive(directoryPath) {
    if (fs.existsSync(directoryPath)) {
        fs.readdirSync(directoryPath).forEach((file, index) => {
          const curPath = path.join(directoryPath, file);
          if (fs.lstatSync(curPath).isDirectory()) {
           // recurse
            deleteFolderRecursive(curPath);
          } else {
            // delete file
            fs.unlinkSync(curPath);
          }
        });
        fs.rmdirSync(directoryPath);
      }
    };