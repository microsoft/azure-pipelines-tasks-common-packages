import { ProtocolType } from "./protocols";
export interface FederatedFeedCredentials {
    accessToken: string;
    feedUrl: URL;
}
export declare function getFederatedWorkloadIdentityCredentials(serviceConnectionName: string, tenantId?: string) : Promise<string | undefined>;
export declare function getFeedTenantId(feedUrl: URL, protocolType?: ProtocolType) : Promise<string | undefined>;
export declare function getFederatedWorkloadIdentityCredentialsForFeed(serviceConnectionName: string, feedUrl: URL, protocolType?: ProtocolType): Promise<FederatedFeedCredentials | undefined>;