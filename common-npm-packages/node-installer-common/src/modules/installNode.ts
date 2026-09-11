import * as os from 'os';
import * as path from 'path';

import * as taskLib from 'azure-pipelines-task-lib/task';
import * as toolLib from 'azure-pipelines-tool-lib/tool';

import { NodeOsArch, InputOsOptions } from '../interfaces/os-types';
import { isDarwinArmWithRosetta } from '../utils/isDarwinArmWithRosetta';
import { downloadNode } from './downloadNode';
import { getExplicitNodeVersion } from './getExplicitNodeVersion';
import { tryFindNodeInCache } from './cache';

/**
 * @param versionSpec Node version to setup. Examples: 1.x, 1.2.x, 1.2.3
 * @param checkLatest
 */
export async function installNode(versionSpec: string, checkLatest: boolean, osOptions?: InputOsOptions) {
    const targetNodeArch = osOptions?.osArch ?? os.arch() as NodeOsArch;
    const targetNodePlatform = osOptions?.osPlatform ?? os.platform();

    if (toolLib.isExplicitVersion(versionSpec)) {
        taskLib.debug(taskLib.loc('DisableCheckLatestExplicitVersion'));
        checkLatest = false;
    }

    let resultNodePath: string | undefined;

    // Check cache
    if (!checkLatest) {
        resultNodePath = tryFindNodeInCache(versionSpec, targetNodeArch);

        // In case if it's darwin arm and toolPath is empty trying to find x64 version
        if (!resultNodePath &&
            isDarwinArmWithRosetta(targetNodePlatform, targetNodeArch)
        ) {
            console.log(taskLib.loc('TryRosettaLocal', targetNodePlatform, targetNodeArch));
            resultNodePath = tryFindNodeInCache(versionSpec, 'x64');
        }
    }

    if (!resultNodePath) {
        const explicitVersion = await getExplicitNodeVersion(
            versionSpec,
            {
                osArch: targetNodeArch,
                osPlatform: targetNodePlatform
            }
        );

        resultNodePath = tryFindNodeInCache(explicitVersion, targetNodeArch);

        if (!resultNodePath) {
            resultNodePath = await downloadNode(
                explicitVersion,
                {
                    osPlatform: targetNodePlatform,
                    osArch: targetNodeArch
                }
            );
        }
    }

    // A tool installer initimately knows details about the layout of that tool.
    // for example, node binary is in the bin folder after the extract on Mac/Linux.
    // layouts could change by version, by platform etc... but that's the tool installers job.
    if (targetNodePlatform !== 'win32') {
        resultNodePath = path.join(resultNodePath, 'bin');
    }

    // Prepend the tools path. instructs the agent to prepend for future tasks.
    toolLib.prependPath(resultNodePath);

    return resultNodePath;
}
