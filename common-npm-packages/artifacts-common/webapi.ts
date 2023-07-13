import Q = require('q');
import * as api from 'azure-devops-node-api';
import { getHandlerFromToken, WebApi } from "azure-devops-node-api";
import { ITaskApi } from "azure-devops-node-api/TaskApi";
import { TaskHubOidcToken } from "azure-devops-node-api/interfaces/TaskAgentInterfaces";
import { IRequestOptions } from 'azure-devops-node-api/interfaces/common/VsoBaseInterfaces';
import * as tl from 'azure-pipelines-task-lib/task';

export function getWebApiWithProxy(serviceUri: string, accessToken: string, options: IRequestOptions = {}): api.WebApi {
    const credentialHandler = api.getBasicHandler('vsts', accessToken);
    const defaultOptions: IRequestOptions = {
        proxy: tl.getHttpProxyConfiguration(serviceUri),
        allowRetries: true,
        maxRetries: 5
    };

    return new api.WebApi(serviceUri, credentialHandler, {...defaultOptions, ...options});
}

export function getSystemAccessToken(): string {
    tl.debug('Getting credentials for local feeds');
    const auth = tl.getEndpointAuthorization('SYSTEMVSSCONNECTION', false);
    if (auth.scheme === 'OAuth') {
        tl.debug('Got auth token');
        return auth.parameters['AccessToken'];
    } else {
        tl.warning('Could not determine credentials to use');
    }
}

export async function getFederatedToken(connectedServiceName: string): Promise<string> {
    const projectId: string = tl.getVariable("System.TeamProjectId");
    const hub: string = tl.getVariable("System.HostType");
    const planId: string = tl.getVariable('System.PlanId');
    const jobId: string = tl.getVariable('System.JobId');
    let uri = tl.getVariable("System.CollectionUri");
    if (!uri) {
        uri = tl.getVariable("System.TeamFoundationServerUri");
    }

    const token = getSystemAccessToken();
    const authHandler = getHandlerFromToken(token);
    const connection = new WebApi(uri, authHandler);
    const oidc_token: string = await initOIDCToken(
        connection,
        projectId,
        hub,
        planId,
        jobId,
        connectedServiceName,
        0,
        2000);

    return oidc_token;
}

function initOIDCToken(connection: WebApi, projectId: string, hub: string, planId: string, jobId: string, serviceConnectionId: string, retryCount: number, timeToWait: number): Q.Promise<string> {
    var deferred = Q.defer<string>();
    connection.getTaskApi().then(
        (taskApi: ITaskApi) => {
            taskApi.createOidcToken({}, projectId, hub, planId, jobId, serviceConnectionId).then(
                (response: TaskHubOidcToken) => {
                    if (response != null) {
                        tl.debug('Got OIDC token');
                        deferred.resolve(response.oidcToken);
                    }
                    else if (response.oidcToken == null) {
                        if (retryCount < 3) {
                            let waitedTime = timeToWait;
                            retryCount += 1;
                            setTimeout(() => {
                                deferred.resolve(initOIDCToken(connection, projectId, hub, planId, jobId, serviceConnectionId, retryCount, waitedTime));
                            }, waitedTime);
                        }
                        else {
                            deferred.reject(tl.loc('CouldNotFetchAccessTokenforAAD'));
                        }
                    }
                },
                (error) => {
                    deferred.reject(tl.loc('CouldNotFetchAccessTokenforAAD') + " " + error);
                }
            );
        }
    );

    return deferred.promise;
}