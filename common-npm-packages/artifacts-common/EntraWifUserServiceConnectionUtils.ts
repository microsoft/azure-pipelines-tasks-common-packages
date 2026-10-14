import path = require("path");
import * as tl from 'azure-pipelines-task-lib/task';
import * as api from "azure-devops-node-api";
import { getSystemAccessToken, requireHttpsUrl } from "./webapi";
import fetch from "node-fetch";
import { retryOnException } from "./retryUtils";
import { verifyAzureArtifactsFeedUrl } from "./feedUrlUtils";
import { ProtocolType } from "./protocols";

tl.setResourcePath(path.join(__dirname, 'module.json'), true);

const ADO_RESOURCE : string = "499b84ac-1321-427f-aa17-267ca6975798/.default";
const CLIENT_ASSERTION_TYPE : string = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const GRANT_TYPE = "client_credentials";
const PPE_HOSTS : string [] = ["vsts.me","codedev.ms","devppe.azure.com"];

export interface FederatedFeedCredentials {
    accessToken: string;
    feedUrl: URL;
}

export async function getFederatedWorkloadIdentityCredentials(serviceConnectionName: string, tenantId?: string) : Promise<string | undefined>{
    const serverType = tl.getVariable("System.ServerType");
    if (serverType?.toLowerCase() !== "hosted") {
        throw new Error(tl.loc("Error_WifAuthenticationHostedOnly"));
    }

    const tenant = tenantId
        ?? tl.getEndpointAuthorizationParameterRequired(serviceConnectionName, "TenantId");
    tl.debug(tl.loc('Info_UsingTenantId', tenant));
    
    return await retryOnException(async () => {
        const oidcToken = await getOidcToken(serviceConnectionName);
        
        tl.setSecret(oidcToken);
        let entraURI = getEntraLoginUrl() + tenant + "/oauth2/v2.0/token";
        let clientId = tl.getEndpointAuthorizationParameterRequired(serviceConnectionName, "ServicePrincipalId");

        let body = {
            'scope': ADO_RESOURCE,
            'client_id': clientId,
            'client_assertion_type': CLIENT_ASSERTION_TYPE,
            'client_assertion': oidcToken,
            'grant_type': GRANT_TYPE
        };

        let formBody = Object.keys(body)
        .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(body[key]))
        .join('&');

        return await fetch(entraURI, {
            method: 'POST', 
            body: formBody,
            headers: 
            {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }).then(async response => {
            var tokenObject = await (response?.json()) as {access_token: string};
    
            if (!tokenObject?.access_token){
                throw new Error(tl.loc("Error_FederatedTokenAquisitionFailed"));
            }
            
            tl.setSecret(tokenObject.access_token);
            return tokenObject.access_token;
        });
    }, 3, 1000);
}

export async function getFeedTenantId(
    feedUrl: string | URL,
    protocolType: ProtocolType = ProtocolType.NuGet
) : Promise<string | undefined>{
    const verifiedFeedUrl = await verifyAzureArtifactsFeedUrl(feedUrl, protocolType);
    return await getTenantIdForVerifiedFeed(verifiedFeedUrl, protocolType);
}

export async function getFederatedWorkloadIdentityCredentialsForFeed(
    serviceConnectionName: string,
    feedUrl: string | URL,
    protocolType: ProtocolType
): Promise<FederatedFeedCredentials | undefined> {
    const verifiedFeedUrl = await verifyAzureArtifactsFeedUrl(feedUrl, protocolType);
    const tenantId = await getTenantIdForVerifiedFeed(verifiedFeedUrl, protocolType);
    if (!tenantId) {
        throw new Error(tl.loc("Error_FeedTenantUnavailable"));
    }

    const accessToken = await getFederatedWorkloadIdentityCredentials(
        serviceConnectionName,
        tenantId
    );
    if (!accessToken) {
        return undefined;
    }

    return {
        accessToken,
        feedUrl: verifiedFeedUrl
    };
}

async function getTenantIdForVerifiedFeed(
    feedUrl: URL,
    protocolType: ProtocolType
): Promise<string | undefined> {
    const tenantDiscoveryUrl = getTenantDiscoveryUrl(
        feedUrl,
        protocolType
    );
    return await getResourceTenantId(tenantDiscoveryUrl);
}

function getTenantDiscoveryUrl(feedUrl: URL, protocolType: ProtocolType): URL {
    const discoveryBaseUrl = new URL(feedUrl.href);
    if (!discoveryBaseUrl.pathname.endsWith("/")) {
        discoveryBaseUrl.pathname += "/";
    }

    if (protocolType === ProtocolType.PyPi &&
        /\/pypi\/upload\/?$/i.test(feedUrl.pathname)) {
        return new URL("../simple/", discoveryBaseUrl);
    }

    if (protocolType === ProtocolType.Cargo &&
        /\/cargo\/index\/?$/i.test(feedUrl.pathname)) {
        return new URL("config.json", discoveryBaseUrl);
    }

    return feedUrl;
}

async function getResourceTenantId(serviceUrl: URL): Promise<string | undefined> {
    try {
        const response = await fetch(serviceUrl.href, {
            method: "HEAD",
            redirect: "manual"
        });

        return response?.headers?.get("X-VSS-ResourceTenant") ?? undefined;
    } catch (error) {
        tl.debug(tl.loc("Error_GetFeedTenantIdFailed", error));
    }

    return undefined;
}


async function getOidcToken(serviceConnectionName: string): Promise<string> {
    const systemServiceUrl =
        requireHttpsUrl(
            tl.getEndpointUrlRequired("SYSTEMVSSCONNECTION")
        ).href;
    const systemAccessToken = getSystemAccessToken();
    if (!systemAccessToken) {
        throw new Error(tl.loc("Error_SystemAccessTokenUnavailable"));
    }
    const webApi = new api.WebApi(
        systemServiceUrl,
        api.getBearerHandler(systemAccessToken),
        { keepAlive: true, maxRedirects: 0 }
    );
    const taskApi = await webApi.getTaskApi();
    const response = await taskApi.createOidcToken(
        {},
        tl.getVariable("System.TeamProjectId"),
        tl.getVariable("System.HostType"),
        tl.getVariable("System.PlanId"),
        tl.getVariable("System.JobId"),
        serviceConnectionName
    );

    if (!response?.oidcToken) {
        throw new Error(tl.loc("Error_FederatedTokenAquisitionFailed"));
    }

    return response.oidcToken;
}

function getEntraLoginUrl() : string {
    var url = process.env["SYSTEM_COLLECTIONURI"];
    let isPPE = false;
    PPE_HOSTS.forEach(ppe_host => {
        if(url.includes(ppe_host)){
            isPPE = true;
        };
    });

    if(isPPE){
        return "https://login.windows-ppe.net/";
    }

    return "https://login.windows.net/";
}
