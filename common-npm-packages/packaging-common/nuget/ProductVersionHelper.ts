import {VersionInfo} from "../pe-parser/VersionResource";

export function getVersionFallback(version: VersionInfo): VersionInfo {
    const productVersion = version.productVersion;
    if ((productVersion.a === 0) && (productVersion.b === 0) && (productVersion.c === 0) && (productVersion.d === 0)) {
        version.productVersion.a = version.fileVersion.a;
        version.productVersion.b = version.fileVersion.b;
        version.productVersion.c = version.fileVersion.c;
        version.productVersion.d = version.fileVersion.d;
    }
    return version;
}