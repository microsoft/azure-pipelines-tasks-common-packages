const fs = require('node:fs');
const path = require('node:path')

const util = require('./util');

const basePath = path.join(__dirname, '..');

const token = process.env['GH_TOKEN'];

if (!token) {
    throw new util.CreateReleaseError('GH_TOKEN is not defined');
}

const OWNER = 'microsoft';
const REPO = 'azure-pipelines-tasks-common-packages';

/**
 * @param {string} [auth] - GitHub authentication token
 */
async function getESMOctokit(auth) {
    const { Octokit } = await import('@octokit/rest');
    return new Octokit({ auth });
}

/**
 * The function looks for the date of the commit where the package version was bumped
 * @param {String} _package - name of the package
 */
async function getPreviousReleaseDate(_package) {
    const packagePath =  path.join(basePath, _package, 'package.json');
    const verRegExp = /"version":/;

    /**
     * Function to get the hash of the commit where the package version was changed
     * @param {RegExp} verRegExp - Regular expression to match the version line in package.json
     * @param {string} [ignoreHash] - Commit hash to ignore in the blame command
     * @returns {string} - Commit hash where the version was changed
     */
    function getHashFromVersion(verRegExp, ignoreHash) {
        let blameResult = '';

        if (ignoreHash) {
            blameResult = util.run(`git blame -w --ignore-rev ${ignoreHash} -- ${packagePath}`);
        } else {
            blameResult = util.run(`git blame -w -- ${packagePath}`);
        }

        const blameLines = blameResult.split('\n');
        const blameLine = blameLines.find(line => verRegExp.test(line));

        if (blameLine === undefined) {
            throw new util.CreateReleaseError(`Could not find version change in ${_package} package`);
        }

        const commitHash = blameLine.split(' ')[0];

        if (commitHash === undefined) {
            throw new util.CreateReleaseError(`Could not find commit hash for version change in ${_package} package`);
        }

        return commitHash;
    }

    if (!fs.existsSync(packagePath)) {
        throw new Error(`Package ${_package} does not exist`);
    }

    const currentHash = getHashFromVersion(verRegExp);
    console.log(`Current version change for ${_package} is ${currentHash}`);
    const prevHash = getHashFromVersion(verRegExp, currentHash);
    console.log(`Previous version change for ${_package} is ${prevHash}`);

    const date = await getPRDateFromCommit(prevHash);
    console.log(`Previous version change date for ${_package} is ${date}`);
    return date;
}


/**
 * Function to get the PR date from the commit hash
 * @param {string} sha1 - commit hash
 * @returns {Promise<string | null>} - date as a string with merged PR
 */
async function getPRDateFromCommit(sha1) {
    const octokit = await getESMOctokit(token);
    const response = await octokit.request('GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls', {
        owner: OWNER,
        repo: REPO,
        commit_sha: sha1,
        headers: {
          'X-GitHub-Api-Version': '2022-11-28'
        }
    });

    if (!response.data.length) {
        throw new Error(`No PRs found for commit ${sha1}`);
    }

    return response.data[0]?.merged_at ?? null;
}

/**
 * Function to get the PR from the branch started from date
 * @param {string} branch - Branch to check for PRs
 * @param {string} date - Date since which to check for PRs
 * @returns {Promise<*>} - PRs merged since date
 */
async function getPRsFromDate(branch, date) {
    const octokit = await getESMOctokit(token);
    const PRs = [];
    let page = 1;
    try {
        while (true) {
            const results = await octokit.search.issuesAndPullRequests({
                q: `type:pr+is:merged+repo:${OWNER}/${REPO}+base:${branch}+merged:>${date}`,
                order: 'asc',
                sort: 'created',
                per_page: 100,
                page
            });

            page++;
            if (results.data.items.length == 0) break;

            PRs.push(...results.data.items);
        }

        return PRs;
    } catch (e) {
        throw new Error(e.message);
    }
}

/**
 * Function to get the changed files for the PRs
 * @param {import('./util').PRDefinition[]} PRs - PRs to get the changed files for
 * @param {string} _package - The name of the package to check for in the changed files
 * @returns {Promise<import('./util').PRDefinition[]>} - Modified files for the PRs which contains packages options.
 */
async function getPRsFiles(PRs, _package) {
    const octokit = await getESMOctokit(token);
    for (let i = 0; i < PRs.length; i++) {
        const PR = PRs[i];
        if (!PR) continue;

        const pull_number = PR.number;
        console.log(`Fetching files for PR ${pull_number}`);
        PR.packageExists = false;
        const response = await octokit.pulls.listFiles({
            owner: OWNER,
            repo: REPO,
            pull_number
        });

        const files = response.data.map(file => file.filename);

        for (let j = 0; j < files.length; j++) {
            const file = files[j];
            if (!file) continue;

            if (file.includes(_package)) {
                PR.packageExists = true;
            }
        }
    }

    return PRs;
}

/**
 * Function that create a release notes + tag for the new release
 * @param {string} releaseNotes - Release notes for the new release
 * @param {string} _package - The name of the package
 * @param {string} version - Version of the new release
 * @param {string} releaseBranch - Branch to create the release on
 */
async function createRelease(releaseNotes, _package, version, releaseBranch) {
    const name = `Release ${_package} ${version}`;
    const tagName = `${_package}-${version}`;
    console.log(`Creating release ${tagName} on ${releaseBranch}`);
    const octokit = await getESMOctokit(token);

    const newRelease = await octokit.repos.createRelease({
        owner: OWNER,
        repo: REPO,
        tag_name: tagName,
        name,
        body: releaseNotes,
        target_commitish: releaseBranch
    });

    console.log(`Release ${tagName} created`);
    console.log(`Release URL: ${newRelease.data.html_url}`);
}

/**
 * Function to verify that the new release tag is valid.
 * @param {string} _package - Sprint version of the checked release
 * @param {string} version - Version of the release to check
 * @returns {Promise<boolean>} - true - release exists, false - release does not exist
 */
async function isReleaseTagExists(_package, version) {
    try {
        const octokit = await getESMOctokit(token);
        const tagName = `${_package}-${version}`;
        await octokit.repos.getReleaseByTag({
            owner: OWNER,
            repo: REPO,
            tag: tagName
        });

        return true;
    } catch (e) {
        return false
    }
}

/**
 * Function to create release notes for the package
 * @param {string} _package - Package name to create release notes for
 * @param {string} branch - Branch to create release notes for
 * @returns
 */
async function createReleaseNotes(_package, branch) {
    try {
        const version = util.getCurrentPackageVersion(_package);
        const isReleaseExists = await isReleaseTagExists(_package, version);
        if (isReleaseExists) {
            console.log(`Release ${_package}-${version} already exists`);
            return;
        }

        const date = await getPreviousReleaseDate(_package);

        if (!date) {
            throw new util.CreateReleaseError(`Could not find previous release date for ${_package}`);
        }

        const data = await getPRsFromDate(branch, date);
        console.log(`Found ${data.length} PRs`);

        const PRs = await getPRsFiles(data, _package);
        const changes = util.getChangesFromPRs(PRs);

        if (!changes.length) {
            console.log(`No changes found for ${_package}`);
            return;
        }

        const releaseNotes = changes.join('\n');
        await createRelease(releaseNotes, _package, version, branch);
    } catch (e) {
        throw new util.CreateReleaseError(e.message);
    }
}
exports.createReleaseNotes = createReleaseNotes;