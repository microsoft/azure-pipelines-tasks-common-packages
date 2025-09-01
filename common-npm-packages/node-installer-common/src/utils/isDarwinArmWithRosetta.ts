import * as taskLib from 'azure-pipelines-task-lib/task';

import { NodeOsArch, NodeOsPlatform } from '../interfaces/os-types';

/**
 * Check is the system is darwin ARM and rosetta is installed.
 * @param osPlatform OS platform.
 * @param installedArch OS architecture.
 * @returns `true` if it's darwin arm with rosetta installed, otherwise `false`
*/
export function isDarwinArmWithRosetta(osPlatform: NodeOsPlatform, installedArch: NodeOsArch): boolean {
    if (osPlatform === 'darwin' && installedArch === 'arm64') {

        // Check that Rosetta is installed and returns some pid
        const execResult = taskLib.execSync('pgrep', 'oahd');

        return execResult.code === 0 && !!execResult.stdout;
    }

    return false;
}
