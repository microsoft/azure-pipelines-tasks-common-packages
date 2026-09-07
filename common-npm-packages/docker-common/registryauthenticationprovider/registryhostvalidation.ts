"use strict";

import * as tl from "azure-pipelines-task-lib/task";

// A cloud whose suffix is missing here is blocked when the feature is on.
const allowedAcrHostSuffixes: string[] = [
    ".azurecr.io",                 // Azure public
    ".azurecr.us",                 // Azure US Government
    ".azurecr.cn",                 // Azure China (21Vianet)
    ".azurecr.de",                 // Azure Germany (legacy)
    ".azurecr.eaglex.ic.gov",      // Azure US Nat (air-gapped)
    ".azurecr.microsoft.scloud",   // Azure US Sec (air-gapped)
];

const hostShape = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function isAllowedAcrHost(registryURL: string): boolean {
    if (!registryURL || typeof registryURL !== "string") {
        return false;
    }

    let host = registryURL;
    if (host.length === 0) {
        return false;
    }

    // A login server is a plain hostname — reject anything with URL syntax.
    if (/[\s/\\?#@]/.test(host)) {
        return false;
    }

    if (host.indexOf(":") !== -1) {
        return false;
    }

    host = host.toLowerCase();

    // Tolerate the FQDN trailing dot.
    if (host.endsWith(".")) {
        host = host.slice(0, -1);
    }

    if (!hostShape.test(host)) {
        return false;
    }

    return allowedAcrHostSuffixes.some(
        (suffix) => host.length > suffix.length && host.endsWith(suffix)
    );
}

export const AcrHostValidationFeatureName = "AcrRegistryHostValidation";

export function guardRegistryHost(registryURL: string, endpointId: string, scheme: string): void {
    if (!tl.getPipelineFeature(AcrHostValidationFeatureName)) {
        return;
    }
    if (!registryURL || isAllowedAcrHost(registryURL)) {
        return;
    }
    tl.warning(tl.loc("UnrecognizedRegistryHost", registryURL, endpointId, scheme));
    throw new Error(tl.loc("InvalidRegistryHost", registryURL));
}
