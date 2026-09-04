"use strict";

import * as tl from "azure-pipelines-task-lib/task";

// Standard ACR login-server suffixes, including sovereign and air-gapped clouds.
const allowedAcrHostSuffixes: string[] = [
    ".azurecr.io",                 // Azure public
    ".azurecr.us",                 // Azure US Government
    ".azurecr.cn",                 // Azure China (21Vianet)
    ".azurecr.de",                 // Azure Germany (legacy)
    ".azurecr.eaglex.ic.gov",      // Azure US Nat (air-gapped)
    ".azurecr.microsoft.scloud",   // Azure US Sec (air-gapped)
];

// Dotted DNS labels without leading or trailing hyphens.
const hostShape = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Returns whether registryURL is a valid standard ACR login server. */
export function isAllowedAcrHost(registryURL: string): boolean {
    if (!registryURL || typeof registryURL !== "string") {
        return false;
    }

    let host = registryURL;
    if (host.length === 0) {
        return false;
    }

    // Reject URL syntax and whitespace; only a hostname is allowed.
    if (/[\s/\\?#@]/.test(host)) {
        return false;
    }

    if (host.indexOf(":") !== -1) {
        return false;
    }

    host = host.toLowerCase();

    // Accept a fully qualified hostname with a trailing root dot.
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

// Opt-in because Azure Stack Hub and other environments can use custom ACR suffixes.
// Enable with DistributedTask.Tasks.AcrRegistryHostValidation=true.
export const AcrHostValidationFeatureName = "AcrRegistryHostValidation";

/**
 * Returns whether the feature gate requires this registry host to be blocked.
 * An empty or absent host is never blocked (there is no host to check).
 */
export function shouldBlockRegistryHost(registryURL: string): boolean {
    return !!registryURL && tl.getPipelineFeature(AcrHostValidationFeatureName) && !isAllowedAcrHost(registryURL);
}
