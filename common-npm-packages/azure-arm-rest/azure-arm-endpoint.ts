import fs = require('fs');
import path = require('path');

import tl = require('azure-pipelines-task-lib/task');
import Q = require('q');

import { ApplicationTokenCredentials } from './azure-arm-common';
import { AzureEndpoint } from './azureModels';
import constants = require('./constants');
import webClient = require('./webClient');

// Isolation is on by default; setting this pipeline feature to true restores the legacy fixed-path behavior.
const DISABLE_CREDENTIAL_FILE_ISOLATION_FEATURE = 'DisableAzureArmEndpointCredentialFileIsolation';
const CREDENTIAL_DIRECTORY_PREFIX = '.azarmrest-endpoint-';
const CERTIFICATE_FILE_NAME = 'spnCert.pem';

const certFilePath: string = path.join(tl.getVariable('Agent.TempDirectory'), CERTIFICATE_FILE_NAME);

// The certificate must outlive getEndpoint because credentials re-read it on every token request,
// so isolated directories are removed by dispose() or, at the latest, when the process exits.
const isolatedCredentialDirectories: Set<string> = new Set<string>();
let exitCleanupRegistered: boolean = false;

tl.setResourcePath(path.join(__dirname, 'module.json'), true);

export class AzureRMEndpoint {
    public endpoint: AzureEndpoint;
    private _connectedServiceName: string;

    // Add an entry here and separate function for each new environment
    private _environments = {
        'AzureStack': 'azurestack'
    }

    private _azureScopes = {
        AzureCloud: {
            resoucemanager: 'https://management.azure.com/.default',
            appservice: 'https://appservice.azure.com/.default',
            storage: 'https://storage.azure.com/.default',
            keyvalut: 'https://vault.azure.net/.default',
            sqldatabase: 'https://database.windows.net/.default',
            cosmosdb: 'https://cosmos.azure.com/.default',
            servicebus: 'https://servicebus.azure.net/.default',
            eventhubs: 'https://eventhubs.azure.net/.default',
            eventgrid: 'https://eventgrid.azure.net/.default',
            cognitiveservices: 'https://cognitiveservices.azure.com/.default',
            containerregistry: 'https://containerregistry.azure.net/.default',
            devops: 'https://app.vssps.visualstudio.com/.default',
            batch: 'https://batch.core.windows.net/.default',
            datafactory: 'https://datafactory.azure.net/.default'
        },
        AzureChinaCloud: {
            resourcemanager: "https://management.chinacloudapi.cn/.default",
            appservice: "https://appservice.azure.cn/.default",
            storage: "https://storage.azure.cn/.default",
            keyvalut: "https://vault.azure.cn/.default",
            sqldatabase: "https://database.chinacloudapi.cn/.default",
            cosmosdb: "https://cosmos.azure.cn/.default",
            servicebus: "https://servicebus.azure.cn/.default",
            eventhubs: "https://eventhubs.azure.cn/.default",
            eventgrid: "https://eventgrid.azure.cn/.default",
            cognitiveservices: "https://cognitiveservices.azure.cn/.default",
            containerregistry: "https://containerregistry.azure.cn/.default",
            devops: "https://app.vssps.visualstudio.cn/.default",
            batch: "https://batch.core.chinacloudapi.cn/.default",
            datafactory: "https://datafactory.azure.cn/.default"
        },
        AzureUSGovernment: {
            resoucemanager: 'https://management.usgovcloudapi.net/.default',
            appservice: 'https://appservice.azure.us/.default',
            storage: 'https://storage.azure.us/.default',
            keyvalut: 'https://vault.azure.us/.default',
            sqldatabase: 'https://database.usgovcloudapi.net/.default',
            cosmosdb: 'https://cosmos.azure.us/.default',
            servicebus: 'https://servicebus.azure.us/.default',
            eventhubs: 'https://eventhubs.azure.us/.default',
            eventgrid: 'https://eventgrid.azure.us/.default',
            cognitiveservices: 'https://cognitiveservices.azure.us/.default',
            containerregistry: 'https://containerregistry.azure.us/.default',
            devops: 'https://app.vssps.visualstudio.us/.default',
            batch: 'https://batch.core.usgovcloudapi.net/.default',
            datafactory: 'https://datafactory.azure.us/.default'
        },
        // BEST-EFFORT / UPFRONT SUPPORT: AzureGermanCloud now maps to the S3NS/SAP "Delos"
        // sovereign cloud (Germany), the successor to the retired Microsoft Cloud Deutschland.
        // Endpoints use the sovcloud-api.de root domain. Only 'appservice' and 'resourcemanager'
        // are authoritative (from the App Service team's cloud.definitions); the remaining
        // audiences are pattern-derived, dormant placeholders (only 'appservice' is consumed
        // today) added ahead of full platform enablement to keep the map shape consistent
        // across clouds. Reconcile the non-appservice audiences against Delos ARM
        // /metadata/endpoints and confirm the platform's SC environment string before any
        // other feature relies on them.
        AzureGermanCloud: {
            resourcemanager: 'https://management.sovcloud-api.de/.default',
            appservice: 'https://appservice.azure.sovcloud-api.de/.default',
            storage: 'https://storage.azure.sovcloud-api.de/.default',
            keyvalut: 'https://vault.azure.sovcloud-api.de/.default',
            sqldatabase: 'https://database.sovcloud-api.de/.default',
            cosmosdb: 'https://cosmos.azure.sovcloud-api.de/.default',
            servicebus: 'https://servicebus.azure.sovcloud-api.de/.default',
            eventhubs: 'https://eventhubs.azure.sovcloud-api.de/.default',
            eventgrid: 'https://eventgrid.azure.sovcloud-api.de/.default',
            cognitiveservices: 'https://cognitiveservices.azure.sovcloud-api.de/.default',
            containerregistry: 'https://containerregistry.azure.sovcloud-api.de/.default',
            devops: 'https://app.vssps.visualstudio.sovcloud-api.de/.default',
            batch: 'https://batch.core.sovcloud-api.de/.default',
            datafactory: 'https://datafactory.azure.sovcloud-api.de/.default'
        },
        // BEST-EFFORT / UPFRONT SUPPORT: AzureBleuCloud maps to the "Bleu" sovereign cloud
        // (France), using the sovcloud-api.fr root domain. Same authoritative/placeholder
        // split as AzureGermanCloud above — added ahead of full ARM + platform enablement
        // (Bleu is not yet registered in the ADO SC environment enum) so the mapping is in
        // place when the cloud comes online. Reconcile the non-appservice audiences against
        // Bleu ARM /metadata/endpoints before any other feature relies on them.
        AzureBleuCloud: {
            resourcemanager: 'https://management.sovcloud-api.fr/.default',
            appservice: 'https://appservice.azure.sovcloud-api.fr/.default',
            storage: 'https://storage.azure.sovcloud-api.fr/.default',
            keyvalut: 'https://vault.azure.sovcloud-api.fr/.default',
            sqldatabase: 'https://database.sovcloud-api.fr/.default',
            cosmosdb: 'https://cosmos.azure.sovcloud-api.fr/.default',
            servicebus: 'https://servicebus.azure.sovcloud-api.fr/.default',
            eventhubs: 'https://eventhubs.azure.sovcloud-api.fr/.default',
            eventgrid: 'https://eventgrid.azure.sovcloud-api.fr/.default',
            cognitiveservices: 'https://cognitiveservices.azure.sovcloud-api.fr/.default',
            containerregistry: 'https://containerregistry.azure.sovcloud-api.fr/.default',
            devops: 'https://app.vssps.visualstudio.sovcloud-api.fr/.default',
            batch: 'https://batch.core.sovcloud-api.fr/.default',
            datafactory: 'https://datafactory.azure.sovcloud-api.fr/.default'
        }
    }

    constructor(connectedServiceName: string) {
        this._connectedServiceName = connectedServiceName;
        this.endpoint = null;
    }

    public async getEndpoint(useGraphActiveDirectoryResource: boolean = false, useMSAL: boolean = false): Promise<AzureEndpoint> {
        if (!!this.endpoint) {
            return this.endpoint;
        }
        else {
            const rawUseMSAL = tl.getVariable("USE_MSAL");
            if (rawUseMSAL) {
                try {
                    tl.debug(`MSAL - USE_MSAL override is found: ${rawUseMSAL}`);
                    const parsedUseMSAL = JSON.parse(rawUseMSAL);
                    if (typeof parsedUseMSAL !== "boolean") {
                        throw new Error("Value is not a boolean");
                    }
                    useMSAL = parsedUseMSAL;
                } catch (error) {
                    // this is not a blocker error, so we're informing
                    tl.debug(`MSAL - USE_MSAL couldn't be parsed due to error ${error}. useMSAL=${useMSAL} is used instead`);
                }
            }

            let endpointAuthScheme = tl.getEndpointAuthorizationScheme(this._connectedServiceName, true);
            if (endpointAuthScheme && endpointAuthScheme.toLowerCase() == constants.AzureRmEndpointAuthenticationScheme.PublishProfile) {

                let resourceId = tl.getEndpointDataParameter(this._connectedServiceName, 'resourceId', true);
                resourceId = resourceId.startsWith("/") ? resourceId : "/" + resourceId;
                let resourceIdSplit = resourceId.split("/");
                if (resourceIdSplit.length < 9) {
                    throw new Error(tl.loc('SpecifiedAzureRmEndpointIsInvalid', ''));
                }

                this.endpoint = {
                    subscriptionName: tl.getEndpointDataParameter(this._connectedServiceName, 'subscriptionname', true),
                    tenantID: tl.getEndpointAuthorizationParameter(this._connectedServiceName, 'tenantid', false),
                    scheme: endpointAuthScheme,
                    PublishProfile: tl.getEndpointAuthorizationParameter(this._connectedServiceName, "publishProfile", true),
                    resourceId: resourceId
                } as AzureEndpoint;
            } else {

                if(endpointAuthScheme && endpointAuthScheme.toLowerCase() == constants.AzureRmEndpointAuthenticationScheme.WorkloadIdentityFederation) {
                    tl.debug(`Overriding useMSAL to ${true} as ${constants.AzureRmEndpointAuthenticationScheme.WorkloadIdentityFederation} supports only MSAL`);
                    useMSAL = true;
                }

                this.endpoint = {
                    subscriptionID: tl.getEndpointDataParameter(this._connectedServiceName, 'subscriptionid', true),
                    subscriptionName: tl.getEndpointDataParameter(this._connectedServiceName, 'subscriptionname', true),
                    servicePrincipalClientID: tl.getEndpointAuthorizationParameter(this._connectedServiceName, 'serviceprincipalid', true),
                    environmentAuthorityUrl: tl.getEndpointDataParameter(this._connectedServiceName, useMSAL ? 'activeDirectoryAuthority' : 'environmentAuthorityUrl', true),
                    tenantID: tl.getEndpointAuthorizationParameter(this._connectedServiceName, 'tenantid', false),
                    url: tl.getEndpointUrl(this._connectedServiceName, true),
                    environment: tl.getEndpointDataParameter(this._connectedServiceName, 'environment', true),
                    scheme: tl.getEndpointAuthorizationScheme(this._connectedServiceName, true),
                    msiClientId: tl.getEndpointDataParameter(this._connectedServiceName, 'msiclientId', true),
                    activeDirectoryResourceID: tl.getEndpointDataParameter(this._connectedServiceName, 'activeDirectoryServiceEndpointResourceId', true),
                    azureKeyVaultServiceEndpointResourceId: tl.getEndpointDataParameter(this._connectedServiceName, 'AzureKeyVaultServiceEndpointResourceId', true),
                    azureKeyVaultDnsSuffix: tl.getEndpointDataParameter(this._connectedServiceName, 'AzureKeyVaultDnsSuffix', true),
                    scopeLevel: tl.getEndpointDataParameter(this._connectedServiceName, 'ScopeLevel', true),
                } as AzureEndpoint;

                tl.debug('MSAL - getEndpoint - useGraphActiveDirectoryResource=' + useGraphActiveDirectoryResource);
                tl.debug('MSAL - getEndpoint - useMSAL=' + useMSAL);
                tl.debug('MSAL - getEndpoint - endpoint=' + JSON.stringify(this.endpoint));
                tl.debug('MSAL - getEndpoint - connectedServiceName=' + this._connectedServiceName);

                if (useGraphActiveDirectoryResource) {
                    const fallbackURL = "https://graph.microsoft.com/";
                    var activeDirectoryResourceId: string = tl.getEndpointDataParameter(this._connectedServiceName, useMSAL ? 'microsoftGraphUrl' : 'graphUrl', true);
                    activeDirectoryResourceId = activeDirectoryResourceId != null ? activeDirectoryResourceId : fallbackURL;
                    this.endpoint.activeDirectoryResourceID = activeDirectoryResourceId;
                    tl.debug('MSAL - getEndpoint - activeDirectoryResourceID=' + this.endpoint.activeDirectoryResourceID);
                }

                this.endpoint.authenticationType = tl.getEndpointAuthorizationParameter(this._connectedServiceName, 'authenticationType', true);

                // if scheme is null, we assume the scheme to be ServicePrincipal
                let isServicePrincipalAuthenticationScheme = !this.endpoint.scheme || this.endpoint.scheme.toLowerCase() == constants.AzureRmEndpointAuthenticationScheme.ServicePrincipal;
                if (isServicePrincipalAuthenticationScheme) {
                    if (this.endpoint.authenticationType && this.endpoint.authenticationType == constants.AzureServicePrinicipalAuthentications.servicePrincipalCertificate) {
                        tl.debug('certificate spn endpoint');
                        this.endpoint.servicePrincipalCertificate = tl.getEndpointAuthorizationParameter(this._connectedServiceName, 'servicePrincipalCertificate', false);
                        this.endpoint.servicePrincipalCertificatePath = writeCertificateFile(this.endpoint.servicePrincipalCertificate);
                    }
                    else {
                        tl.debug('credentials spn endpoint');
                        this.endpoint.servicePrincipalKey = tl.getEndpointAuthorizationParameter(this._connectedServiceName, 'serviceprincipalkey', false);
                    }
                }

                var isADFSEnabled = tl.getEndpointDataParameter(this._connectedServiceName, 'EnableAdfsAuthentication', true);
                this.endpoint.isADFSEnabled = isADFSEnabled && (isADFSEnabled.toLowerCase() == "true");

                if (!!this.endpoint.environment && this.endpoint.environment.toLowerCase() == this._environments.AzureStack) {
                    if (!this.endpoint.environmentAuthorityUrl || !this.endpoint.activeDirectoryResourceID) {
                        this.endpoint = await this._updateAzureStackData(this.endpoint);
                    }
                }
                else {
                    const fallbackURL = useMSAL ? "https://login.microsoftonline.com/" : "https://login.windows.net/";
                    this.endpoint.environmentAuthorityUrl = (!!this.endpoint.environmentAuthorityUrl) ? this.endpoint.environmentAuthorityUrl : fallbackURL;
                    if (!useGraphActiveDirectoryResource) {
                        this.endpoint.activeDirectoryResourceID = this.endpoint.url;
                    }
                }
                let scopes: any;
                const allowScopeLevelToken = tl.getPipelineFeature("ALLOWSCOPELEVELTOKEN");
                if (allowScopeLevelToken && this.endpoint.environment && this.endpoint.environment.toLowerCase() != this._environments.AzureStack) {
                    scopes = this.getScopesByEnvironment();
                }
                let access_token: string = tl.getEndpointAuthorizationParameter(this._connectedServiceName, "apitoken", true);
                this.endpoint.applicationTokenCredentials = new ApplicationTokenCredentials(
                    this._connectedServiceName,
                    this.endpoint.servicePrincipalClientID,
                    this.endpoint.tenantID,
                    this.endpoint.servicePrincipalKey,
                    this.endpoint.url,
                    this.endpoint.environmentAuthorityUrl,
                    this.endpoint.activeDirectoryResourceID,
                    !!this.endpoint.environment && this.endpoint.environment.toLowerCase() == constants.AzureEnvironments.AzureStack,
                    this.endpoint.scheme,
                    this.endpoint.msiClientId,
                    this.endpoint.authenticationType,
                    this.endpoint.servicePrincipalCertificatePath,
                    this.endpoint.isADFSEnabled,
                    access_token,
                    useMSAL,
                    allowScopeLevelToken,
                    scopes
                );
            }
        }
        tl.debug(JSON.stringify(this.endpoint));
        return this.endpoint;
    }

    private async _updateAzureStackData(endpoint: AzureEndpoint): Promise<AzureEndpoint> {
        let dataDeferred = Q.defer<AzureEndpoint>();
        let webRequest = new webClient.WebRequest();
        webRequest.uri = `${endpoint.url}metadata/endpoints?api-version=2015-01-01`;
        webRequest.method = 'GET';
        webRequest.headers = {
            'Content-Type': 'application/json'
        }

        let azureStackResult;
        try {
            let response: webClient.WebResponse = await webClient.sendRequest(webRequest);
            if (response.statusCode != 200) {
                tl.debug("Action: _updateAzureStackData, Response: " + JSON.stringify(response));
                throw new Error(response.statusCode + ' ' + response.statusMessage)
            }

            azureStackResult = response.body;
        }
        catch (error) {
            throw new Error(tl.loc("FailedToFetchAzureStackDependencyData", error.toString()));
        }

        endpoint.graphEndpoint = azureStackResult.graphEndpoint;
        endpoint.galleryUrl = azureStackResult.galleryUrl;
        endpoint.portalEndpoint = azureStackResult.portalEndpoint;
        var authenticationData = azureStackResult.authentication;
        if (!!authenticationData) {
            var loginEndpoint: string = authenticationData.loginEndpoint;
            if (!!loginEndpoint) {
                loginEndpoint += (loginEndpoint[loginEndpoint.length - 1] == "/") ? "" : "/";
                endpoint.activeDirectoryAuthority = loginEndpoint;
                endpoint.environmentAuthorityUrl = loginEndpoint;
                endpoint.isADFSEnabled = loginEndpoint.endsWith('/adfs/');
            }
            else {
                // change to login endpoint
                throw new Error(tl.loc('UnableToFetchAuthorityURL'));
            }

            var audiences = authenticationData.audiences;
            if (audiences && audiences.length > 0) {
                endpoint.activeDirectoryResourceID = audiences[0];
            }

            try {
                var endpointUrl = endpoint.url;
                endpointUrl += (endpointUrl[endpointUrl.length - 1] == "/") ? "" : "/";
                var index = endpointUrl.indexOf('.');
                var domain = endpointUrl.substring(index + 1);
                domain = (domain.lastIndexOf("/") == domain.length - 1) ? domain.substring(0, domain.length - 1) : domain;
                endpoint.azureKeyVaultDnsSuffix = ("vault." + domain).toLowerCase();
                endpoint.azureKeyVaultServiceEndpointResourceId = ("https://vault." + domain).toLowerCase();
            }
            catch (error) {
                throw new Error(tl.loc("SpecifiedAzureRmEndpointIsInvalid", endpointUrl));
            }
        }

        return endpoint;
    }

    private getScopesByEnvironment(): any {
         return this._azureScopes[this.endpoint.environment];
    }
}

function writeCertificateFile(certificateContent: string): string {
    if (tl.getPipelineFeature(DISABLE_CREDENTIAL_FILE_ISOLATION_FEATURE)) {
        publishCertificateCredentialTelemetry({ isolation: 'disabled' });
        fs.writeFileSync(certFilePath, certificateContent);
        return certFilePath;
    }

    publishCertificateCredentialTelemetry({ isolation: 'enabled' });
    const directoryPath = fs.mkdtempSync(path.join(tl.getVariable('Agent.TempDirectory'), CREDENTIAL_DIRECTORY_PREFIX));
    trackIsolatedCredentialDirectory(directoryPath);
    if (process.platform !== 'win32') {
        fs.chmodSync(directoryPath, 0o700);
    }

    const certificatePath = path.join(directoryPath, CERTIFICATE_FILE_NAME);
    fs.writeFileSync(certificatePath, certificateContent, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return certificatePath;
}

function trackIsolatedCredentialDirectory(directoryPath: string): void {
    isolatedCredentialDirectories.add(directoryPath);
    if (!exitCleanupRegistered) {
        exitCleanupRegistered = true;
        process.once('exit', () => cleanupIsolatedCredentialDirectories('exit'));
    }
}

// Never throws so it is safe to call from finally blocks and the process exit handler.
function cleanupIsolatedCredentialDirectories(trigger: 'dispose' | 'exit'): void {
    isolatedCredentialDirectories.forEach((directoryPath: string) => {
        isolatedCredentialDirectories.delete(directoryPath);

        let outcome: string;
        try {
            outcome = removeIsolatedCredentialDirectory(directoryPath);
            if (outcome === 'rejected') {
                tl.warning('Skipped removing the Azure RM service-principal certificate because the credential directory is not valid.');
            }
        } catch (error) {
            outcome = 'error';
            tl.warning('Failed to remove the Azure RM service-principal certificate.');
            tl.debug(`Failed to remove the Azure RM certificate credential directory: ${error && error.code || error}`);
        }

        publishCertificateCredentialTelemetry({ cleanup: outcome, trigger: trigger });
    });
}

// Deliberately avoids tl.rmRF, which follows directory links (symlinks/junctions) and deletes their targets.
function removeIsolatedCredentialDirectory(directoryPath: string): 'deleted' | 'notfound' | 'rejected' {
    const agentTempDirectory: string = tl.getVariable('Agent.TempDirectory');
    if (!agentTempDirectory
        || !isSamePath(path.dirname(directoryPath), agentTempDirectory)
        || path.basename(directoryPath).indexOf(CREDENTIAL_DIRECTORY_PREFIX) !== 0) {
        return 'rejected';
    }

    let directoryStats: fs.Stats;
    try {
        directoryStats = fs.lstatSync(directoryPath);
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            return 'notfound';
        }
        throw error;
    }

    if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
        return 'rejected';
    }

    try {
        fs.unlinkSync(path.join(directoryPath, CERTIFICATE_FILE_NAME));
    } catch (error) {
        if (!error || error.code !== 'ENOENT') {
            throw error;
        }
    }

    fs.rmdirSync(directoryPath);
    return 'deleted';
}

function isSamePath(first: string, second: string): boolean {
    const resolvedFirst = path.resolve(first);
    const resolvedSecond = path.resolve(second);
    return process.platform === 'win32'
        ? resolvedFirst.toLowerCase() === resolvedSecond.toLowerCase()
        : resolvedFirst === resolvedSecond;
}

// Only fixed values are published: isolation (enabled|disabled),
// cleanup (deleted|notfound|rejected|error) with trigger (dispose|exit).
function publishCertificateCredentialTelemetry(properties: { [key: string]: string }): void {
    try {
        console.log(`##vso[telemetry.publish area=TaskDeploymentMethod;feature=AzureRMEndpointCertificateCredentials]${JSON.stringify(properties)}`);
    } catch (error) {
        tl.debug(`Failed to publish Azure RM certificate credential telemetry: ${error}`);
    }
}

export function dispose() {
    cleanupIsolatedCredentialDirectories('dispose');
    if (tl.exist(certFilePath)) {
        tl.rmRF(certFilePath);
        tl.debug('Removed cert endpoint file');
    }
}