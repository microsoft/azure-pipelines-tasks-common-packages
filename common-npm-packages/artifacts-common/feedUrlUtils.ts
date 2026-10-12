import * as path from "path";
import * as tl from "azure-pipelines-task-lib/task";
import { getConnectionDataForProtocol } from "./connectionDataUtils";
import { getPackagingAccessMappings } from "./packagingAccessMappingUtils";
import { ProtocolType } from "./protocols";

tl.setResourcePath(path.join(__dirname, "module.json"), true);

/**
 * Verifies that a URL can safely receive Azure Artifacts credentials.
 * The URL must match an access mapping returned by authenticated Packaging discovery.
 */
export async function verifyAzureArtifactsFeedUrl(
    feedUrl: URL,
    protocolType: ProtocolType = ProtocolType.NuGet
): Promise<URL> {
    const candidate = requireAzureArtifactsFeedUrl(feedUrl);
    const connectionData = await getConnectionDataForProtocol(protocolType);
    if (!connectionData?.locationServiceData) {
        throw new Error(tl.loc("Error_FeedUrlUntrustedHost"));
    }

    let mappings;
    try {
        mappings = getPackagingAccessMappings(
            connectionData.locationServiceData
        );
    } catch (error) {
        if (error instanceof Error &&
            error.message === tl.loc("Error_ServiceUrlHttpsRequired")) {
            throw new Error(tl.loc("Error_FeedUrlHttpsRequired"));
        }
        throw error;
    }
    const matchesMapping = mappings.some(mapping =>
        isUrlOnSameHost(candidate, new URL(mapping.uri))
    );

    if (!matchesMapping) {
        throw new Error(tl.loc("Error_FeedUrlUntrustedHost"));
    }

    return candidate;
}

export function parseAzureArtifactsFeedUrl(feedUrl: string): URL {
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(feedUrl);
    } catch {
        throw new Error(tl.loc("Error_FeedUrlInvalid"));
    }

    return requireAzureArtifactsFeedUrl(parsedUrl);
}

function requireAzureArtifactsFeedUrl(feedUrl: URL): URL {
    if (feedUrl.protocol.toLowerCase() !== "https:") {
        throw new Error(tl.loc("Error_FeedUrlHttpsRequired"));
    }
    if (feedUrl.username || feedUrl.password) {
        throw new Error(tl.loc("Error_FeedUrlInvalid"));
    }

    return feedUrl;
}

function isUrlOnSameHost(candidate: URL, trustedUrl: URL): boolean {
    if (candidate.origin === trustedUrl.origin) {
        return true;
    }

    return isVisualStudioHost(candidate) && isVisualStudioHost(trustedUrl);
}

function isVisualStudioHost(url: URL): boolean {
    return url.hostname.toLowerCase().endsWith(".visualstudio.com");
}
