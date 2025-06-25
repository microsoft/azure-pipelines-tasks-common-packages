const { execSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { styleText } = require('node:util');

const packages = [
    'artifacts-common',
    'az-blobstorage-provider',
    'azure-arm-rest',
    'azurermdeploycommon',
    'codeanalysis-common',
    'codecoverage-tools',
    'docker-common',
    'ios-signing-common',
    'java-common',
    'kubernetes-common',
    'msbuildhelpers',
    'packaging-common',
    'securefiles-common',
    'utility-common',
    'webdeployment-common',
];

const gitDiffResult = execSync('git --no-pager diff --name-only origin/master', { encoding: 'utf8' }).split('\n');
const changedFolders = new Set();

for (const filePath of gitDiffResult) {
    for (const pkg of packages) {
        // Check if the file path starts with the package folder name
        if (filePath.startsWith(`common-npm-packages/${pkg}/`)) {
            changedFolders.add(pkg);
        }
    }
}

if (changedFolders.size > 0) {
    const errors = [];

    for (const pkg of changedFolders) {
        const pkgJsonPath = join(__dirname, '../common-npm-packages', pkg, 'package.json');
        try {
            const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
            const currentVersion = pkgJson.version;
            // Get package.json from main branch
            let mainVersion = null;
            try {
                const mainPkgJsonRaw = execSync(`git show main:common-npm-packages/${pkg}/package.json`, { encoding: 'utf8' });
                const mainPkgJson = JSON.parse(mainPkgJsonRaw);
                mainVersion = mainPkgJson.version;
            } catch (err) {
                // If package.json doesn't exist in main, treat as new package
            }

            if (mainVersion && compareVersions(mainVersion, currentVersion) >= 0) {
                errors.push({
                    pkg,
                    mainVersion,
                    currentVersion
                });
            }
        } catch (err) {
            console.warn(`Could not read version for ${pkg}:`, err.message);
        }
    }
    if (errors.length > 0) {
        console.error(styleText('red', 'Error: The following packages have not been updated correctly:'));
        errors.forEach(error => {
            console.error(`Local version ${styleText('green', error.currentVersion)} <= main version ${styleText('redBright', error.mainVersion)} for package ${styleText('blueBright', error.pkg)}.`);
        });
        process.exit(1);
    }
} else {
    console.log('No changed package folders detected.');
}

/**
 * Compare two semver strings. Returns 1 if a > b, 0 if a == b, -1 if a < b
 * @param {string} a - The first version string to compare
 * @param {string} b - The second version string to compare
 * @returns
 */
function compareVersions(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na > nb) return 1;
        if (na < nb) return -1;
    }
    return 0;
}