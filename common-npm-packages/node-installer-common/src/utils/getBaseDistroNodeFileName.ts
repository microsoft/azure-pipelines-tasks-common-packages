import { NodeOsPlatform, NodeOsArch, TargetOsInfo } from '../interfaces/os-types';

/**
 * Gets node file from the base distro.
 * @param version Node version
 * @param osPlatform Node os platform. darwin, linux, windows, etc.
 * @param osArch Node os arch. x86, x68, arm, etc.
 * @returns Node file name from the base distro
 */
export function getBaseDistroFileName(version: string, osInfo: TargetOsInfo): string {
    return osInfo.osPlatform === 'win32' ?
        'node-v' + version + '-win-' + osInfo.osArch :
        'node-v' + version + '-' + osInfo.osPlatform + '-' + osInfo.osArch;
}
