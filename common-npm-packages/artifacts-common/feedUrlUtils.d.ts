import { ProtocolType } from "./protocols";
export declare function verifyAzureArtifactsFeedUrl(feedUrl: URL, protocolType?: ProtocolType): Promise<URL>;
export declare function parseAzureArtifactsFeedUrl(feedUrl: string): URL;
