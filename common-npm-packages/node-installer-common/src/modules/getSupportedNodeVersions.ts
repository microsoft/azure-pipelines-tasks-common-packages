import * as toolLib from 'azure-pipelines-tool-lib/tool';

import { IApiNodeVersion } from '../interfaces/IApiNodeVersion';

/**
 * @param nodeVersions
 * @param dataFileName
 * @returns Array of supported node versions. Format ``
 */
export function getSupportedNodeVersions(
    nodeVersions: IApiNodeVersion[],
    dataFileName: string
): {
    supportedNodeVersions: IApiNodeVersion[],
    semanticSupportedNodeVersions: string[]
} {

    const supportedNodeVersions: IApiNodeVersion[] = [];
    const cleanSupportedNodeVersions: string[] = [];

    for (const nodeVersion of nodeVersions) {

        // ensure this version supports your os and platform
        if (nodeVersion.files.indexOf(dataFileName) >= 0) {

            // versions in the file are prefixed with 'v', which is not valid SemVer
            // remove 'v' so that toolLib.evaluateVersions behaves properly
            cleanSupportedNodeVersions.push(toolLib.cleanVersion(nodeVersion.version));
            supportedNodeVersions.push(nodeVersion);
        }
    }

    return { supportedNodeVersions, semanticSupportedNodeVersions: cleanSupportedNodeVersions };
}
