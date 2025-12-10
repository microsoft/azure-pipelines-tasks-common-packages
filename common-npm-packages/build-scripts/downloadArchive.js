const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');

const syncRequest = require('sync-request');

const util = require('./util');

/**
 * Downloads a file from the specified URL and saves it to the downloadPath.
 * @param {string} url - The URL of the file to download.
 * @param {string} downloadPath - The path where the downloaded file should be saved.
 * @returns {string} - The path to the downloaded file.
 */
const downloadFile = function (url, downloadPath) {
    // validate parameters
    if (!url) {
        throw new Error('Parameter "url" must be set.');
    }

    // skip if already downloaded
    const scrubbedUrl = url.replace(/[/\:?]/g, '_');
    const targetPath = path.join(downloadPath, 'file', scrubbedUrl);
    const marker = targetPath + '.completed';
    if (!util.test('-f', marker)) {
        console.log('Downloading file: ' + url);

        // delete any previous partial attempt
        if (util.test('-f', targetPath)) {
            util.rm('-f', targetPath);
        }

        // download the file
        util.mkdir('-p', path.join(downloadPath, 'file'));
        // @ts-ignore
        const result = syncRequest('GET', url);
        fs.writeFileSync(targetPath, result.getBody());

        // write the completed marker
        fs.writeFileSync(marker, '');
    }

    return targetPath;
}

/**
 * Downloads an archive from the specified URL and extracts it to the downloadPath.
 * @param {string} url - The URL of the archive to download.
 * @param {string} downloadPath - The path where the downloaded archive should be saved.
 * @returns {string} - The path to the extracted archive directory.
 */
const downloadArchive = function (url, downloadPath) {
    // validate parameters
    if (!url) {
        throw new Error('Parameter "url" must be set.');
    }

    let isZip;
    let isTargz;

    if (url.match(/\.zip$/)) {
        isZip = true;
    } else if (url.match(/\.tar\.gz$/) && (process.platform == 'darwin' || process.platform == 'linux')) {
        isTargz = true;
    } else {
        throw new Error('Unexpected archive extension');
    }

    // skip if already downloaded and extracted
    const scrubbedUrl = url.replace(/[/\:?]/g, '_');
    const targetPath = path.join(downloadPath, 'archive', scrubbedUrl);
    const marker = targetPath + '.completed';

    if (!util.test('-f', marker)) {
        // download the archive
        const archivePath = downloadFile(url, downloadPath);
        console.log('Extracting archive: ' + url);

        // delete any previously attempted extraction directory
        if (util.test('-d', targetPath)) {
            util.rm('-rf', targetPath);
        }

        // extract
        util.mkdir('-p', targetPath);

        if (isZip) {
            if (process.platform == 'win32') {
                let escapedFile = archivePath.replace(/'/g, "''").replace(/"|\n|\r/g, ''); // double-up single quotes, remove double quotes and newlines
                let escapedDest = targetPath.replace(/'/g, "''").replace(/"|\n|\r/g, '');

                let command = `$ErrorActionPreference = 'Stop' ; try { Add-Type -AssemblyName System.IO.Compression.FileSystem } catch { } ; [System.IO.Compression.ZipFile]::ExtractToDirectory('${escapedFile}', '${escapedDest}')`;
                util.run(`powershell -Command "${command}"`);
            } else {
                util.run(`unzip ${archivePath} -d ${targetPath}`);
            }
        } else if (isTargz) {
            const originalCwd = process.cwd();
            util.cd(targetPath);

            try {
                util.run(`tar -xzf "${archivePath}"`);
            } finally {
                util.cd(originalCwd);
            }
        }

        // write the completed marker
        fs.writeFileSync(marker, '');
    }

    return targetPath;
}

// If this script is run directly, download the archive and copy its contents to the destination
if (require.main === module) {
    const [ archiveUrl, dest ] = process.argv.slice(2);

    if (!archiveUrl) {
        throw new Error('Archive URL must be specified as the first argument');
    }

    if (!dest) {
        throw new Error('Destination path must be specified as the second argument');
    }

    const targetPath = downloadArchive(archiveUrl, path.join('../_download', dest));

    if (!fs.existsSync(dest)) {
        util.mkdir('-p', dest);
    }
    util.cp('-rf', path.join(targetPath, '*'), dest);
}

exports.downloadArchive = downloadArchive;