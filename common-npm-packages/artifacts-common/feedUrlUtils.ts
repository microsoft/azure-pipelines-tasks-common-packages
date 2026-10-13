import * as path from "path";
import * as tl from "azure-pipelines-task-lib/task";
import { getConnectionDataForProtocol } from "./connectionDataUtils";
import { getHttpsPackagingAccessMappings } from "./packagingAccessMappingUtils";
import { ProtocolType } from "./protocols";
import { requireHttpsUrl } from "./webapi";

tl.setResourcePath(path.join(__dirname, "module.json"), true);

/**
 * Verifies that a URL can safely receive Azure Artifacts credentials.
 * The URL must match an access mapping returned by authenticated Packaging discovery.
 */
export async function verifyAzureArtifactsFeedUrl(
    feedUrl: string | URL,
    protocolType: ProtocolType = ProtocolType.NuGet
): Promise<URL> {
    const candidate = requireHttpsUrl(feedUrl);
    const connectionData = await getConnectionDataForProtocol(protocolType);
    if (!connectionData?.locationServiceData) {
        throw new Error(tl.loc("Error_FeedUrlUntrustedHost"));
    }

    const trustedUrls = getHttpsPackagingAccessMappings(
        connectionData.locationServiceData
    ).map(mapping => new URL(mapping.uri));
    const matchesMapping = trustedUrls.some(trustedUrl =>
        isUrlOnSameHost(candidate, trustedUrl)
    );

    if (!matchesMapping) {
        throw new Error(tl.loc("Error_FeedUrlUntrustedHost"));
    }

    return candidate;
}

function isUrlOnSameHost(candidate: URL, trustedUrl: URL): boolean {
    if (candidate.origin === trustedUrl.origin) {
        return true;
    }

    return (
        isProductionAzureArtifactsHost(candidate) &&
        isProductionAzureArtifactsHost(trustedUrl)
    ) || (
        isDevFabricAzureArtifactsHost(candidate) &&
        isDevFabricAzureArtifactsHost(trustedUrl)
    );
}

function isProductionAzureArtifactsHost(url: URL): boolean {
    const hostname = url.hostname.toLowerCase();
    return hostname === "dev.azure.com" ||
        hostname === "pkgs.dev.azure.com" ||
        isVisualStudioHost(url);
}

function isDevFabricAzureArtifactsHost(url: URL): boolean {
    const hostname = url.hostname.toLowerCase();
    return isHostOrSubdomain(hostname, "codedev.ms") ||
        isHostOrSubdomain(hostname, "vsts.me") ||
        isHostOrSubdomain(hostname, "devppe.azure.com");
}

function isHostOrSubdomain(hostname: string, domain: string): boolean {
    return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isVisualStudioHost(url: URL): boolean {
    return url.hostname.toLowerCase().endsWith(".visualstudio.com");
}
