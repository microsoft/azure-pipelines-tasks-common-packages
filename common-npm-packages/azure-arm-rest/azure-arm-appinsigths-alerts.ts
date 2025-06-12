import path = require('path');

import tl = require('azure-pipelines-task-lib/task');

import { AzureEndpoint, IAzureMetricAlertRequestBody } from './azureModels';
import { ServiceClient } from './AzureServiceClient';
import { ToError } from './AzureServiceClientBase';
import { APIVersions } from './constants';
import webClient = require('./webClient');

tl.setResourcePath(path.join(__dirname, 'module.json'), true);

export class AzureMonitorAlerts {
    private _resourceGroupName: string;
    private _endpoint: AzureEndpoint;
    private _client: ServiceClient;

    constructor(endpoint: AzureEndpoint, resourceGroupName: string) {
        this._client = new ServiceClient(endpoint.applicationTokenCredentials, endpoint.subscriptionID, 30);
        this._endpoint = endpoint;
        this._resourceGroupName = resourceGroupName;
    }

    public async get(alertRuleName: string) {
        tl.debug(`Getting AzureRm alert rule - '${alertRuleName}' in resource group '${this._resourceGroupName}'`);

        var httpRequest = new webClient.WebRequest();
        httpRequest.method = 'GET';

        httpRequest.uri = this._client.getRequestUri(`//subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/microsoft.insights/alertrules/{resourceName}`,
        {
            '{resourceGroupName}': this._resourceGroupName,
            '{resourceName}': alertRuleName,
        }, null, APIVersions.azure_arm_metric_alerts);

        try {
            var response = await this._client.beginRequest(httpRequest);
            if(response.statusCode == 200) {
                return response.body;
            }

            throw response;
        }
        catch(error) {
            throw Error(tl.loc('FailedToGetAzureMetricAlerts', alertRuleName, this._client.getFormattedError(error)));
        }
    }

    public async update(alertRuleName: string, resourceBody: IAzureMetricAlertRequestBody) {
        var httpRequest = new webClient.WebRequest();
        httpRequest.method = 'PUT';
        httpRequest.body = JSON.stringify(resourceBody);
        httpRequest.uri = this._client.getRequestUri(`//subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.insights/alertrules/{resourceName}`,
        {
            '{resourceGroupName}': this._resourceGroupName,
            '{resourceName}': alertRuleName,
        }, null, APIVersions.azure_arm_metric_alerts);

        try {
            var response = await this._client.beginRequest(httpRequest);
            if(response.statusCode == 200) {
                console.log(tl.loc("UpdatedRule",alertRuleName));
                return response.body as IAzureMetricAlertRequestBody;
            }
            else if(response.statusCode == 201) {
                console.log(tl.loc("CreatedRule", alertRuleName));
                return response.body as IAzureMetricAlertRequestBody;
            }

            throw ToError(response);
        }
        catch(error) {
            throw Error(tl.loc('FailedToUpdateAzureMetricAlerts', alertRuleName, this._client.getFormattedError(error)));
        }
    }


}

