const { join } = require('path');
const { readConfigFile, sys } = require('typescript');

const { cp, mkdirP, rmRF } = require('azure-pipelines-task-lib');

const buildPath = readConfigFile("tsconfig.json", sys.readFile).config.compilerOptions.outDir;

function prebuild() {
    rmRF(buildPath, { recursive: true, force: true });
}

function postbuild() {
    mkdirP(join(__dirname, "./_build"));
    cp(join(__dirname, 'package.json'), join(buildPath, 'package.json'));
    cp(join(__dirname, 'package-lock.json'), join(buildPath, 'package-lock.json'));
    cp(join(__dirname, 'module.json'), join(buildPath, 'module.json'));
    cp(join(__dirname, 'node_modules'), join(__dirname, buildPath, 'node_modules'), '-rf');
    cp(join(__dirname, 'Strings'), join(__dirname, buildPath, 'Strings'), '-rf');
}

if (process.argv.includes('--prebuild')) {
    prebuild();
} else if (process.argv.includes('--postbuild')) {
    postbuild();
}
