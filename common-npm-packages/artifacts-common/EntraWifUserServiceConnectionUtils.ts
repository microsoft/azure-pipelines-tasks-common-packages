import path = require("path");
import * as tl from 'azure-pipelines-task-lib/task';
import { getSystemAccessToken } from "./webapi";
import fetch from "node-fetch";

tl.setResourcePath(path.join(__dirname, 'module.json'), true);

const ADO_RESOURCE : string = "499b84ac-1321-427f-aa17-267ca6975798/.default";
const CLIENT_ASSERTION_TYPE : string = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const GRANT_TYPE = "client_credentials";

export async function getFederatedWorkloadIdentityCredentials(serviceConnectionName: string, tenantId?: string) : Promise<string | undefined>
{
    try {
        let tenant = tenantId ?? tl.getEndpointAuthorizationParameterRequired(serviceConnectionName, "TenantId");
        tl.debug(tl.loc('Info_UsingTenantId', tenantId));
        const systemAccessToken = getSystemAccessToken();
        const url = process.env["SYSTEM_OIDCREQUESTURI"]+"?api-version=7.1&serviceConnectionId="+serviceConnectionName;
        
        const ADOResponse: {oidcToken: string} = await (await fetch(url, 
        {
            method: 'POST', 
            headers: 
            {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer '+ systemAccessToken
            }
        })).json() as {oidcToken: string};

        tl.setSecret(ADOResponse.oidcToken);
        let entraURI = "https://login.windows.net/"+tenant+"/oauth2/v2.0/token";
        let clientId = tl.getEndpointAuthorizationParameterRequired(serviceConnectionName, "ServicePrincipalId");

        let body = {
            'scope': ADO_RESOURCE,
            'client_id': clientId,
            'client_assertion_type': CLIENT_ASSERTION_TYPE,
            'client_assertion': ADOResponse.oidcToken,
            'grant_type': GRANT_TYPE
        };

        let formBody = Object.keys(body)
        .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(body[key]))
        .join('&');

        const entraResponse: {access_token: string} = await (await fetch(entraURI, 
        {
            method: 'POST', 
            body: formBody,
            headers: 
            {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        })).json() as {access_token: string};
        tl.setSecret(entraResponse.access_token);
        return entraResponse.access_token;
    } 
    catch (error) 
    {
        tl.error(tl.loc("Error_FederatedTokenAquisitionFailed", error));
        return undefined;
    }
}

export async function getFeedTenantId(feedUrl: string) : Promise<string | undefined>
{
    try
    {
        const feedResponse =  await fetch(feedUrl);
        return feedResponse?.headers?.get('X-VSS-ResourceTenant');
    } 
    catch (error)
    {
        tl.warning(tl.loc("Error_GetFeedTenantIdFailed", error));
        return undefined;
    }
}