import tl = require('azure-pipelines-task-lib/task');
import { getHandlerFromToken, WebApi } from "azure-devops-node-api";
import { ITaskApi } from "azure-devops-node-api/TaskApi";
import { TaskHubOidcToken } from "azure-devops-node-api/interfaces/TaskAgentInterfaces";
import Q = require('q');

export function getSystemAccessToken(): string {
    tl.debug('Getting credentials for account feeds');
    let auth = tl.getEndpointAuthorization('SYSTEMVSSCONNECTION', false);
    if (auth && auth.scheme === 'OAuth') {
        tl.debug('Got auth token, setting it as secret so it does not print in console log');
        tl.setSecret(auth.parameters['AccessToken']);
        return auth.parameters['AccessToken'];
    }
    tl.warning(tl.loc('FeedTokenUnavailable'));
    return '';
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
    
    tl.setSecret(oidc_token);
    
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
