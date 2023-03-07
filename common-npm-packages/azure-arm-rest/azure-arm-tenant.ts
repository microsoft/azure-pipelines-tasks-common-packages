import tl = require('azure-pipelines-task-lib/task');
import msRestAzure = require('./azure-arm-common');
import azureServiceClientBase = require('./AzureServiceClientBase');
import depolymentsBase = require('./DeploymentsBase');
import path = require('path');

tl.setResourcePath(path.join(__dirname, 'module.json'), true);

export class TenantManagementClient extends azureServiceClientBase.AzureServiceClientBase {

    public tenantId: string;

    constructor(credentials: msRestAzure.ApplicationTokenCredentials, tenantId: string, options?: any) {
        super(credentials);
        this.validateInputs(tenantId);
        this.apiVersion = '2021-04-01';
        this.acceptLanguage = 'en-US';
        this.generateClientRequestId = true;
        if (!!options && !!options.longRunningOperationRetryTimeout) {
            this.longRunningOperationRetryTimeout = options.longRunningOperationRetryTimeout;
        }
        this.deployments = new TenantDeployments(this);
        this.tenantId = tenantId;
    }

    public getRequestUri(uriFormat: string, parameters: {}, queryParameters?: string[], apiVersion?: string): string {
        return super.getRequestUriForBaseUri(this.baseUri, uriFormat, parameters, queryParameters, apiVersion);
    }

    private validateInputs(tenantId: string) {
        if (!tenantId) {
            throw new Error(tl.loc("TenantIdCannotBeNull"));
        }
    }
}

export class TenantDeployments extends depolymentsBase.DeploymentsBase {

    protected client: TenantManagementClient;

    constructor(client: TenantManagementClient) {
        super(client);
        this.client = client;
    }

    public createOrUpdate(deploymentName, deploymentParameters, callback) {

        // Create HTTP request uri
        var requestUri = this.client.getRequestUri(
            '/providers/Microsoft.Resources/deployments/{deploymentName}',
            {
                '{deploymentName}': deploymentName
            }
        );
        super.deployTemplate(requestUri, deploymentName, deploymentParameters, callback);
    }

    public validate(deploymentName, deploymentParameters, callback) {

        // Create HTTP request uri
        var requestUri = this.client.getRequestUri(
            '/providers/Microsoft.Resources/deployments/{deploymentName}/validate',
            {
                '{deploymentName}': deploymentName
            }
        );
        super.validateTemplate(requestUri, deploymentName, deploymentParameters, callback);
    }
}