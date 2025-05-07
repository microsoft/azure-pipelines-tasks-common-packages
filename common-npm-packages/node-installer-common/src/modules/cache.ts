import * as toolLib from 'azure-pipelines-tool-lib/tool';

import { NodeOsArch } from '../interfaces/os-types';

export function tryFindNodeInCache(version: string, osArch: NodeOsArch): string | undefined {
    return toolLib.findLocalTool('node', version, osArch);
}
