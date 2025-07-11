import path = require('path');

import tl = require('azure-pipelines-task-lib/task');
import Q = require('q');

import msRestAzure = require('./azure-arm-common');
import azureServiceClient = require('./AzureServiceClient');
import azureServiceClientBase = require('./AzureServiceClientBase');
import Model = require('./azureModels');
import webClient = require('./webClient');

tl.setResourcePath(path.join(__dirname, 'module.json'), true);

export class StorageManagementClient extends azureServiceClient.ServiceClient {
    public storageAccounts: StorageAccounts;

    constructor(credentials: msRestAzure.ApplicationTokenCredentials, subscriptionId: string, baseUri?: any, options?: any) {
        super(credentials, subscriptionId);

        this.acceptLanguage = 'en-US';
        this.generateClientRequestId = true;
        this.apiVersion = (credentials.isAzureStackEnvironment) ? '2015-06-15' : '2017-06-01';

        if (!options)
            options = {};

        if (baseUri) {
            this.baseUri = baseUri;
        }

        if (options.acceptLanguage) {
            this.acceptLanguage = options.acceptLanguage;
        }
        if (options.longRunningOperationRetryTimeout) {
            this.longRunningOperationRetryTimeout = options.longRunningOperationRetryTimeout;
        }
        if (options.generateClientRequestId) {
            this.generateClientRequestId = options.generateClientRequestId;
        }
        this.storageAccounts = new StorageAccounts(this);
    }
}

export class StorageAccounts {
    private client: StorageManagementClient;

    constructor(client) {
        this.client = client;
    }

    public async list(options): Promise<Model.StorageAccount[]> {
        var httpRequest = new webClient.WebRequest();
        httpRequest.method = 'GET';
        httpRequest.headers = this.client.setCustomHeaders(options);
        // Getting all azure rm storage accounts (along with resource group names) for the given subscription.
        httpRequest.uri = this.client.getRequestUri('//subscriptions/{subscriptionId}/providers/Microsoft.Storage/storageAccounts', {});

        var deferred = Q.defer<Model.StorageAccount[]>();
        var result = [];
        this.client.beginRequest(httpRequest).then(async (response) => {
            if (response.statusCode == 200) {
                if (response.body.value) {
                    let storageAccounts: Model.StorageAccount[] = response.body.value;
                    result = result.concat(storageAccounts);
                }

                if (response.body.nextLink) {
                    var nextResult = await this.client.accumulateResultFromPagedResult(response.body.nextLink);
                    if (nextResult.error) {
                        deferred.reject(nextResult.error);
                    }

                    let storageAccounts: Model.StorageAccount[] = nextResult.result;
                    result = result.concat(storageAccounts);
                }

                deferred.resolve(result);
            }
            else {
                deferred.reject(azureServiceClientBase.ToError(response));
            }
        }).catch(function (error) {
            deferred.reject(error);
        });

        return deferred.promise;
    }

    public async listClassicAndRMAccounts(options): Promise<Model.StorageAccount[]> {
        var httpRequest = new webClient.WebRequest();
         httpRequest.method = 'GET';
         httpRequest.headers = this.client.setCustomHeaders(options);

         // Getting all storage accounts (azure rm and classic, along with resource group names) for the given subscription.
         httpRequest.uri = "https://management.azure.com/resources?api-version=2014-04-01-preview&%24filter=(subscriptionId%20eq%20'{subscriptionId}')%20and%20(resourceType%20eq%20'microsoft.storage%2Fstorageaccounts'%20or%20resourceType%20eq%20'microsoft.classicstorage%2Fstorageaccounts')";
         httpRequest.uri = httpRequest.uri.replace('{subscriptionId}', this.client.subscriptionId);

         var deferred = Q.defer<Model.StorageAccount[]>();
         var result = [];
         this.client.beginRequest(httpRequest).then(async (response) => {
             if (response.statusCode == 200) {
                 if (response.body.value) {
                     let storageAccounts: Model.StorageAccount[] = response.body.value;
                     result = result.concat(storageAccounts);
                 }

                 if (response.body.nextLink) {
                     var nextResult = await this.client.accumulateResultFromPagedResult(response.body.nextLink);
                     if (nextResult.error) {
                         deferred.reject(nextResult.error);
                     }

                     let storageAccounts: Model.StorageAccount[] = nextResult.result;
                     result = result.concat(storageAccounts);
                 }

                 deferred.resolve(result);
             }
             else {
                 deferred.reject(azureServiceClientBase.ToError(response));
             }
         }).catch(function(error) {
             deferred.reject(error);
         });

         return deferred.promise;
     }

    public async getClassicOrArmAccountByName(accountName: string, options: any): Promise<Model.StorageAccount | undefined> {
        let storageAccounts = await this.getStorageAccountsByUri(
            `https://management.azure.com/subscriptions/${this.client.subscriptionId}/providers/Microsoft.Storage/storageAccounts?api-version=2023-01-01`,
            accountName,
            options
        );

        const armStorageAccount = storageAccounts[0];
        if (armStorageAccount) {
            return armStorageAccount;
        }

        storageAccounts = await this.getStorageAccountsByUri(
            `https://management.azure.com/subscriptions/${this.client.subscriptionId}/providers/Microsoft.ClassicStorage/storageAccounts?api-version=2016-11-01`,
            accountName,
            options
        );

        return storageAccounts[0];
    }

    public async listKeys(resourceGroupName: string, accountName: string, options, storageAccountType?: string): Promise<string[]> {
        if (resourceGroupName === null || resourceGroupName === undefined || typeof resourceGroupName.valueOf() !== 'string') {
            throw new Error(tl.loc("ResourceGroupCannotBeNull"));
        }

        if (accountName === null || accountName === undefined || typeof accountName.valueOf() !== 'string') {
            throw new Error(tl.loc("StorageAccountCannotBeNull"));
        }

        var apiVersion = "2017-06-01";
        var resourceProvider = "Microsoft.Storage";
        if (!!storageAccountType && storageAccountType.toLowerCase().indexOf("classicstorage") > 0) {
            resourceProvider = "Microsoft.ClassicStorage";
            apiVersion = "2015-12-01";
        }

        var httpRequest = new webClient.WebRequest();
        httpRequest.method = 'POST';
        httpRequest.headers = this.client.setCustomHeaders(options);
        httpRequest.uri = this.client.getRequestUri(
            '//subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/{provider}/storageAccounts/{storageAccountName}/listKeys',
            {
                '{resourceGroupName}': resourceGroupName,
                '{storageAccountName}': accountName,
                '{provider}': resourceProvider
            },
            [],
            apiVersion
        );

        var deferred = Q.defer<string[]>();
        var accessKeys: string[] = [];
        this.client.beginRequest(httpRequest).then((response) => {
            if (response.statusCode == 200) {
                if (resourceProvider === "Microsoft.ClassicStorage") {
                    accessKeys[0] = response.body.primaryKey;
                    accessKeys[1] = response.body.secondaryKey;
                } else if (response.body.keys) {
                    let keys = response.body.keys;
                    for (let i = 0; i < keys.length; i++) {
                        accessKeys[i] = keys[i]["value"];
                    }
                }

                deferred.resolve(accessKeys);
            } else {
                deferred.reject(azureServiceClientBase.ToError(response));
            }
        }).catch(function (error) {
            deferred.reject(error);
        });

        return deferred.promise;
    }

    public async get(storageAccountName: string): Promise<Model.StorageAccount> {
        let storageAccounts = await this.list(null);
        let index = storageAccounts.findIndex(account => account.name.toLowerCase() === storageAccountName.toLowerCase());

        if (index < 0) {
            throw new Error(tl.loc("StorageAccountDoesNotExist", storageAccountName));
        }

        return storageAccounts[index];
    }

    public async getStorageAccountProperties(resourceGroupName: string, storageAccountName: string): Promise<Model.StorageAccount | undefined> {
        if (resourceGroupName === null || resourceGroupName === undefined || typeof resourceGroupName.valueOf() !== 'string') {
            throw new Error(tl.loc("ResourceGroupCannotBeNull"));
        }

        if (storageAccountName === null || storageAccountName === undefined || typeof storageAccountName.valueOf() !== 'string') {
            throw new Error(tl.loc("StorageAccountCannotBeNull"));
        }

        // SubscribtionId will be placed automatically
        // The endpoint for storage account
        let response = await this.sendRequest(
            "GET",
            "//subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/Microsoft.Storage/storageAccounts/{storageAccountName}",
            {
                '{resourceGroupName}': resourceGroupName,
                '{storageAccountName}': storageAccountName
            }
        );

        if (response.statusCode == 200) {
            return response.body;
        }

        // SubscribtionId will be placed automatically
        // The endpoint for classic storage account
        response = await this.sendRequest(
            "GET",
            "//subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/Microsoft.ClassicStorage/storageAccounts/{storageAccountName}",
            {
                '{resourceGroupName}': resourceGroupName,
                '{storageAccountName}': storageAccountName
            }
        );

        if (response.statusCode == 200) {
            return response.body;
        }

        return undefined;
    }

    public static getResourceGroupNameFromUri(resourceUri: string): string {
        if (this.isNonEmptyInternal(resourceUri)) {
            resourceUri = resourceUri.toLowerCase();
            return resourceUri.substring(resourceUri.indexOf("resourcegroups/") + "resourcegroups/".length, resourceUri.indexOf("/providers"));
        }
        return "";
    }

    /**
     * The method is wrapping the request call for the azure storage service.
     * SubscrubtionID is placed automatically in this.client.getRequestUri method based on this.client.subscriptionId
     * The same with apiVersion
     */
    private async sendRequest(method: string, uri: string, bindings?: {}, options?: any): Promise<webClient.WebResponse> {
        const request = new webClient.WebRequest();
        request.method = method;
        request.headers = this.client.setCustomHeaders(options);
        request.uri = this.client.getRequestUri(
            uri,
            bindings,
            []
        );

        const response =  await this.client.beginRequest(request);

        return response;
    }

    private async getStorageAccountsByUri(uri: string, filterName?: string, options?: any): Promise<Model.StorageAccount[]> {
        const request = new webClient.WebRequest();
        request.method = 'GET';
        request.headers = this.client.setCustomHeaders(options);
        request.uri = uri;

        const storageAccounts: Model.StorageAccount[] = [];

        const response = await this.client.beginRequest(request);
        if (response.statusCode !== 200) {
            throw azureServiceClientBase.ToError(response);
        }

        storageAccounts.push(...response.body.value);

        if (filterName) {
            const targetSA = storageAccounts.find(sa => sa.name === filterName);

            if (targetSA) {
                return [targetSA];
            }
        }

        if (response.body.nextLink) {
            const nextResult = await this.client.accumulateResultFromPagedResult(response.body.nextLink);
            if (nextResult.error) {
                throw nextResult.error;
            }

            storageAccounts.push(...nextResult.result);
        }

        if (filterName) {
            const targetSA = storageAccounts.find(sa => sa.name === filterName);

            return targetSA ? [targetSA] : [];
        }

        return storageAccounts;
    }

    private static isNonEmptyInternal(str: string): boolean {
        return (!!str && !!str.trim());
    }
}