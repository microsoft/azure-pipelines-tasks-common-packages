import * as taskLib from 'azure-pipelines-task-lib/task';
import * as toolLib from 'azure-pipelines-tool-lib/tool';

import { NodeOsArch, TargetOsInfo } from '../interfaces/os-types';
import { isDarwinArmWithRosetta } from '../utils/isDarwinArmWithRosetta';
import { fetchLatestMatchNodeVersion } from './fetchNodeVersion';

/**
 * Gets explicit node version. If input version not already explicit, checks the node distro to match version.
 * @param versionSpec Input version spec.
 * @param targetOsInfo Os info.
 * @returns Explicit node version.
 */
export async function getExplicitNodeVersion(versionSpec: string, targetOsInfo: TargetOsInfo): Promise<string> {

    taskLib.debug(taskLib.loc('GettingExplicitNodeVersion', versionSpec));
    if (toolLib.isExplicitVersion(versionSpec)) {
        return versionSpec;
    }

    let targetNodeArch: NodeOsArch = targetOsInfo.osArch;

    // query nodejs.org for a matching version
    let matchedNodeVersion = await fetchLatestMatchNodeVersion(versionSpec, targetOsInfo);

    if (!matchedNodeVersion && isDarwinArmWithRosetta(targetOsInfo.osPlatform, targetOsInfo.osArch)) {
        // nodejs.org does not have an arm64 build for macOS, so we fall back to x64
        console.log(taskLib.loc('TryRosettaRemote', targetOsInfo.osPlatform, targetNodeArch));

        targetNodeArch = 'x64';
        matchedNodeVersion = await fetchLatestMatchNodeVersion(versionSpec, targetOsInfo);
    }

    if (!matchedNodeVersion) {
        throw new Error(taskLib.loc('NodeVersionNotFound', versionSpec, targetOsInfo.osPlatform, targetNodeArch));
    }

    return matchedNodeVersion;
}
