import * as taskLib from 'azure-pipelines-task-lib/task';
import * as toolLib from 'azure-pipelines-tool-lib/tool';
import { RestClient } from 'typed-rest-client/RestClient';
import { IRequestOptions } from 'typed-rest-client/Interfaces';

import { getSupportedNodeVersions } from './getSupportedNodeVersions';
import { BASE_NODE_VERSIONS_URL } from '../constants';
import { IApiNodeVersion } from '../interfaces/IApiNodeVersion';
import { TargetOsInfo } from '../interfaces/os-types';

/**
 * Get node lates version which matches with input non-explicit version
 * @param versionSpec Node version specification (e.g. 1.x)
 * @param osInfo OS info: arch, platform
 * @returns Semantic latest Node version that matches spec.
 **/
export async function fetchLatestMatchNodeVersion(versionSpec: string, osInfo: TargetOsInfo): Promise<string | undefined> {

    const nodeVersions = await fetchAllNodeVersions();

    const dataFileName = getDataFileName(osInfo);
    const { semanticSupportedNodeVersions } = getSupportedNodeVersions(nodeVersions, dataFileName);

    const latestMatchVersion = toolLib.evaluateVersions(semanticSupportedNodeVersions, versionSpec);

    return latestMatchVersion;
}

function getDataFileName(osInfo: TargetOsInfo) {
    const { osPlatform, osArch } = osInfo;

    switch (osPlatform) {
        case 'linux': return 'linux-' + osArch;

        case 'darwin': return 'osx-' + osArch + '-tar';

        case 'win32': return 'win-' + osArch + '-exe';

        default: throw new Error(taskLib.loc('UnexpectedOS', osArch));
    }
}

export async function fetchAllNodeVersions(): Promise<IApiNodeVersion[]> {
    const proxyRequestOptions: IRequestOptions = {
        proxy: taskLib.getHttpProxyConfiguration(BASE_NODE_VERSIONS_URL) ?? undefined,
        cert: taskLib.getHttpCertConfiguration() ?? undefined,
        ignoreSslError: !!taskLib.getVariable('Agent.SkipCertValidation')
    };
    const restC = new RestClient('azp-node-installer-common', undefined, undefined, proxyRequestOptions);

    const fetchedNodeVersions = (await restC.get<IApiNodeVersion[]>(BASE_NODE_VERSIONS_URL)).result;

    return fetchedNodeVersions!;
}
