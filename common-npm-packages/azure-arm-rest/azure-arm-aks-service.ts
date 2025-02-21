import msRestAzure = require('./azure-arm-common');
import tl = require('azure-pipelines-task-lib/task');
import Model = require("./azureModels");
import util = require('util');
import webClient = require('./webClient');
import Q = require('q');
import path = require('path');
import {
    AzureEndpoint,
    AKSCluster
} from './azureModels';

import {
    ServiceClient
} from './AzureServiceClient';

import {
    ToError
} from './AzureServiceClientBase';

tl.setResourcePath(path.join(__dirname, 'module.json'), true);

export class AzureAksService {

    public _client: ServiceClient;

    constructor(endpoint: AzureEndpoint) {
        this._client = new ServiceClient(endpoint.applicationTokenCredentials, endpoint.subscriptionID, 30);
    }

    public beginRequest(uri: string,  parameters: {}, apiVersion: string, method: string) : Promise<webClient.WebResponse> {
         var webRequest = new webClient.WebRequest();
         webRequest.method = method || 'GET';
         webRequest.uri = this._client.getRequestUri(uri, parameters, null, apiVersion);
        return this._client.beginRequestExpBackoff(webRequest, 3).then((response)=>{
            if(response.statusCode >= 200 && response.statusCode < 300) {
                return response;
            } else {
                throw ToError(response);
            }
        });
    } 

    public getAccessProfile(resourceGroup : string , clusterName : string, useClusterAdmin?: boolean): Promise<Model.AKSClusterAccessProfile> {
        var accessProfileName = !!useClusterAdmin ? 'clusterAdmin' : 'clusterUser';
        return this.beginRequest(`//subscriptions/{subscriptionId}/resourceGroups/{ResourceGroupName}/providers/Microsoft.ContainerService/managedClusters/{ClusterName}/accessProfiles/{AccessProfileName}`,
        {
            '{ResourceGroupName}': resourceGroup,
            '{ClusterName}': clusterName,
            '{AccessProfileName}': accessProfileName
        }, '2017-08-31', "GET").then((response) => {
            return  response.body;
        }, (reason) => {
            throw Error(tl.loc('CantDownloadAccessProfile',clusterName,  this._client.getFormattedError(reason)));
        });
    }

    public getCredentials(resourceGroup: string, name: string, isFleet: boolean, useClusterAdmin?: boolean): Promise<Model.AKSCredentialResults> {
    let uri: string;
    let parameters: any;
    let apiVersion: string;

    if (isFleet) {
        uri = `//subscriptions/{subscriptionId}/resourceGroups/{ResourceGroupName}/providers/Microsoft.ContainerService/fleets/{FleetName}/listCredentials`;
        parameters = {
            '{ResourceGroupName}': resourceGroup,
            '{FleetName}': name,
        };
        apiVersion = '2024-04-01';
    } else {
        const credentialAction = !!useClusterAdmin ? 'listClusterAdminCredential' : 'listClusterUserCredential';
        uri = `//subscriptions/{subscriptionId}/resourceGroups/{ResourceGroupName}/providers/Microsoft.ContainerService/managedClusters/{ClusterName}/{CredentialAction}`;
        parameters = {
            '{ResourceGroupName}': resourceGroup,
            '{ClusterName}': name,
            '{CredentialAction}': credentialAction,
        };
        apiVersion = '2024-05-01';
    }

    return this.beginRequest(uri, parameters, apiVersion, "POST").then((response) => {
        return response.body;
    }, (reason) => {
        throw Error(tl.loc('CantDownloadClusterCredentials', name, this._client.getFormattedError(reason)));
    });
}

public getClusterCredential(resourceGroup: string, name: string, isFleet: boolean, useClusterAdmin?: boolean, credentialName?: string): Promise<Model.AKSCredentialResult> {
    const credentialsPromise = this.getCredentials(resourceGroup, name, isFleet, useClusterAdmin);
    return credentialsPromise.then((credentials) => {
        const credential = isFleet ? credentials.kubeconfigs[0] : credentials.kubeconfigs.find(cred => cred.name === (credentialName || (!!useClusterAdmin ? 'clusterAdmin' : 'clusterUser')));
        if (credential === undefined) {
            throw Error(tl.loc('CantDownloadClusterCredentials', name, `${credentialName || 'default'} not found in the list of credentials.`));
        }
        return credential;
    });
}

}