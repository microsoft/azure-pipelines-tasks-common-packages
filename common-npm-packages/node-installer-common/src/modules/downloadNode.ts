import * as path from 'path';

import * as taskLib from 'azure-pipelines-task-lib/task';
import * as toolLib from 'azure-pipelines-tool-lib/tool';

import { NodeOsArch, TargetOsInfo } from '../interfaces/os-types';
import { BASE_NODE_DISTRIBUTION_URL } from '../constants';
import { getBaseDistroFileName } from '../utils/getBaseDistroNodeFileName';
import { extractArchive } from '../utils/extractArchive';

/**
 * Downloads node from the base distribution: https://nodejs.org/dist.
 *
 * @param targetNodeVersion Node version to download. Must be explicit.
 * @param installedArch arch.
 * @returns The path on which the Node was cached.
 */
export async function downloadNodeFromBaseDistro(targetNodeVersion: string, targetOsInfo: TargetOsInfo): Promise<string> {

    if (!toolLib.isExplicitVersion(targetNodeVersion)) {
        throw new Error('Node version must be explicit.');
    }

    targetNodeVersion = toolLib.cleanVersion(targetNodeVersion);

    const downloadUrl = getBaseDownloadUrl(targetNodeVersion, targetOsInfo);

    try {
        const downloadedNodePath = await toolLib.downloadTool(downloadUrl);

        const extractedNodePath = await extractArchive(downloadedNodePath);

        const fileName = getBaseDistroFileName(targetNodeVersion, targetOsInfo.osPlatform, targetOsInfo.osArch);

        //
        // Install into the local tool cache - node extracts with a root folder that matches the fileName downloaded
        //
        const downloadedNodeRoot = path.join(extractedNodePath, fileName);

        return await toolLib.cacheDir(downloadedNodeRoot, 'node', targetNodeVersion, targetOsInfo.osArch);
    } catch (err) {
        if (err.httpStatusCode &&
            // tslint:disable-next-line: triple-equals
            err.httpStatusCode == 404) {
            return await downloadNodeFromFallbackLocation(targetNodeVersion, targetOsInfo.osArch);
        }

        throw err;
    }
}

/**
 * For non LTS versions of Node, the files we need (for Windows) are sometimes located
 * in a different folder than they normally are for other versions.
 *
 * Normally the format is similar to: https://nodejs.org/dist/v5.10.1/node-v5.10.1-win-x64.7z.
 * In this case, there will be two files located at:
 *
 *     /dist/v5.10.1/win-x64/node.exe
 *     /dist/v5.10.1/win-x64/node.lib
 *
 * If this is not the structure, there may also be two files located at:
 *
 *     /dist/v0.12.18/node.exe
 *     /dist/v0.12.18/node.lib
 *
 * This method attempts to download and cache the resources from these alternative locations.
 *
 * Note also that the files are normally zipped but in this case they are just an exe
 * and lib file in a folder, not zipped.
 *
 * @param version Node version to download.
 * @param arch OS arch.
 * @returns The path on which the Node was cached.
 */
export async function downloadNodeFromFallbackLocation(version: string, arch: NodeOsArch): Promise<string> {
    // Create temporary folder to download in to
    const tempDownloadFolder: string = 'temp_' + Math.floor(Math.random() * 2e9);
    const agentTempDir = taskLib.getVariable('agent.tempDirectory')!;
    const tempDir: string = path.join(agentTempDir, tempDownloadFolder);
    taskLib.mkdirP(tempDir);

    let exeUrl: string;
    let libUrl: string;
    try {
        exeUrl = `${BASE_NODE_DISTRIBUTION_URL}/v${version}/win-${arch}/node.exe`;
        libUrl = `${BASE_NODE_DISTRIBUTION_URL}/v${version}/win-${arch}/node.lib`;

        await toolLib.downloadTool(exeUrl, path.join(tempDir, 'node.exe'));
        await toolLib.downloadTool(libUrl, path.join(tempDir, 'node.lib'));
    } catch (err) {
        if (err.httpStatusCode &&
            // tslint:disable-next-line: triple-equals
            err.httpStatusCode == 404) {
            exeUrl = `${BASE_NODE_DISTRIBUTION_URL}/v${version}/node.exe`;
            libUrl = `${BASE_NODE_DISTRIBUTION_URL}/v${version}/node.lib`;

            await toolLib.downloadTool(exeUrl, path.join(tempDir, 'node.exe'));
            await toolLib.downloadTool(libUrl, path.join(tempDir, 'node.lib'));
        } else {
            throw err;
        }
    }

    return await toolLib.cacheDir(tempDir, 'node', version, arch);
}

export function getBaseDownloadUrl(nodeVersion: string, targetOsInfo: TargetOsInfo) {

    const fileName = getBaseDistroFileName(nodeVersion, targetOsInfo.osPlatform, targetOsInfo.osArch);

    const urlFileName: string =
        targetOsInfo.osPlatform === 'win32' ?
            fileName + '.7z' :
            fileName + '.tar.gz';

    // example: https://nodejs.org/dist/v10.24.1/node-v10.24.1-linux-x64.tar.gz
    const downloadUrl = BASE_NODE_DISTRIBUTION_URL + '/v' + nodeVersion + '/' + urlFileName;

    return downloadUrl;
}
