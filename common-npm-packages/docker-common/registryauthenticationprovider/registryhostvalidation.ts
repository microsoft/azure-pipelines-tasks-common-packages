"use strict";

import * as tl from "azure-pipelines-task-lib/task";
import * as path from "path";
import { URL } from "url";

tl.setResourcePath(path.join(__dirname, "..", "module.json"), true);

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

// A registry login server is normally just a host (e.g. "contoso.azurecr.io"); this reduces whatever
// value we were given to that host[:port] for logging. new URL(...).host drops any scheme, "user:pass@"
// userinfo and path/query, so nothing but the host is logged. A scheme is prepended when the value is a
// bare host so it parses, and an unparseable value becomes "***". Same URL parsing other tasks use to
// read a registry host (e.g. AzureFunctionOnKubernetes' dockerConnection.ts, ContainerBasedDeploymentUtility.ts).
export function sanitizeUrl(url: string): string {
    if (!url) {
        return url;
    }
    try {
        return new URL(url.includes("://") ? url : `https://${url}`).host;
    } catch {
        return "***";
    }
}

export function guardRegistryHost(registryURL: string, endpointId: string, scheme: string): void {
    if (!tl.getPipelineFeature(AcrHostValidationFeatureName)) {
        return;
    }
    if (isAllowedAcrHost(registryURL)) {
        return;
    }
    // An empty/absent login server is not a legitimate ACR host, so it also lands here as invalid.
    const safeUrl = sanitizeUrl(registryURL) || "";
    tl.warning(tl.loc("UnrecognizedRegistryHost", safeUrl, endpointId, scheme));
    throw new Error(tl.loc("InvalidRegistryHost", safeUrl));
}
