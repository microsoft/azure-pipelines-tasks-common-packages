const fs = require('fs');
const util = require('./common-npm-packages/build-scripts/util');
const releaseNotes = require('./common-npm-packages/build-scripts/create-release');

console.log('Creating GitHub releases for shared npm packages');

async function createGitHubReleases(packages) {
    const releaseTarget = process.env['RELEASE_TARGET'];
    if (!releaseTarget) {
        throw new util.CreateReleaseError('RELEASE_TARGET is not defined');
    }

    const failures = [];
    for (let i = 0; i < packages.length; i++) {
        const package = packages[i];
        if (fs.statSync(package).isDirectory() &&  ['build-scripts', '.git', '_download', 'node_modules'].indexOf(package) < 0) {
            console.log('\n----------------------------------');
            console.log(package);
            console.log('----------------------------------');
            try {
                await releaseNotes.createReleaseNotes(package, 'main', releaseTarget);
            }
            catch(ex) {
                if (ex instanceof util.CreateReleaseError) {
                    console.error(`Error creating release notes for ${package}: ${ex.message}`);
                    failures.push(package);
                } else {
                    throw ex;
                }
            }
        }
    }

    if (failures.length > 0) {
        throw new util.CreateReleaseError(`Failed to create GitHub releases for: ${failures.join(', ')}`);
    }
}

util.cd('common-npm-packages');
const packages = fs.readdirSync('./', { encoding: 'utf-8' });
createGitHubReleases(packages).catch(error => {
    console.error(`Failed to create GitHub releases: ${error.message}`);
    process.exitCode = 1;
});