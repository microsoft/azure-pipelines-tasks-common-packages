import msRestAzure = require('./azure-arm-common');
import azureServiceClientBase = require('./AzureServiceClientBase');
import depolymentsBase = require('./DeploymentsBase');
export declare class TenantManagementClient extends azureServiceClientBase.AzureServiceClientBase {
    tenantId: string;
    constructor(credentials: msRestAzure.ApplicationTokenCredentials, tenantId: string, options?: any);
    getRequestUri(uriFormat: string, parameters: {}, queryParameters?: string[], apiVersion?: string): string;
    private validateInputs(tenantId);
}
export declare class TenantDeployments extends depolymentsBase.DeploymentsBase {
    protected client: TenantManagementClient;
    constructor(client: TenantManagementClient);
    createOrUpdate(deploymentName: any, deploymentParameters: any, callback: any): void;
    validate(deploymentName: any, deploymentParameters: any, callback: any): void;
}
