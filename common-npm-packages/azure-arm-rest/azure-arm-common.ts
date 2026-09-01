import crypto = require('crypto');
import fs = require('fs');
import path = require('path');
import querystring = require('querystring');

import { Mutex } from 'async-mutex';
import { getHandlerFromToken, WebApi } from 'azure-devops-node-api';
import tl = require('azure-pipelines-task-lib/task');
import HttpsProxyAgent = require('https-proxy-agent');
import fetch = require('node-fetch');
import jwt = require('jsonwebtoken');
import Q = require('q');

import azCliUtility = require('./azCliUtility');
import AzureModels = require('./azureModels');
import constants = require('./constants');
import webClient = require('./webClient');

// Important note! Since the msal v2.** and @azure/identity don't work with Node 10, and we still need to support Node 10 execution handler, a dynamic loading was implemented.
// Dynamic loading imposes restrictions on type validation when compiling TypeScript and we can't use it in this case.
// For this reason, all msal types and @azure/identity types were temporarily replaced with 'any' type.
// When the support for Node 10 is dropped, the types should be restored and the dynamic loading should be removed.

/// Dynamic msal loading based on the node version
const nodeVersion = parseInt(process.version.split('.')[0].replace('v', ''));
const msalVer = nodeVersion < 16 ? "msalv1" : "msalv3";

// Maximum backoff timeout for creating AAD token in milliseconds
const MAX_CREATE_AAD_TOKEN_BACKOFF_TIMEOUT = 15000;

tl.debug('Using ' + msalVer);
const msal = require(msalVer);

/// Dynamic @azure/identity loading based on the node version
/// The @azure/identity package depends on @azure/msal-node which uses modern JavaScript features like optional chaining
/// that are not supported in Node 10. We only load it when running on Node 14+.
let azureIdentity: any;
if (nodeVersion >= 16) {
    azureIdentity = require("@azure/identity");
}

///

tl.setResourcePath(path.join(__dirname, 'module.json'), true);

export class ApplicationTokenCredentials {
    public baseUrl: string;
    public authorityUrl: string;
    public activeDirectoryResourceId: string;
    public isAzureStackEnvironment: boolean;
    public scheme: number;
    public msiClientId: string;

    private connectedServiceName: string;
    private clientId: string;
    private tenantId: string;
    private authType: string;
    private secret?: string;
    private accessToken?: string;
    private certFilePath?: string;
    private isADFSEnabled?: boolean;
    private token_deferred: Q.Promise<string>;
    private useMSAL: boolean;
    private msalInstance: any; //msal.ConfidentialClientApplication
    private scopes: any;
    private allowScopeLevelToken: boolean;

    // Records the audience/outcome of the most recent acquireTokenForScope call so callers
    // (e.g. the Kudu auth layer) can emit a single unified auth-mode telemetry event without
    // re-deriving the scoped-vs-broad decision. Non-sensitive metadata only - never a token.
    private _lastRequestedAudience: string = undefined;
    private _lastScopeOutcome: string = undefined;

    private readonly tokenMutex: Mutex;

    constructor(
        connectedServiceName: string,
        clientId: string,
        tenantId: string,
        secret: string,
        baseUrl: string,
        authorityUrl: string,
        activeDirectoryResourceId: string,
        isAzureStackEnvironment: boolean,
        scheme?: string,
        msiClientId?: string,
        authType?: string,
        certFilePath?: string,
        isADFSEnabled?: boolean,
        access_token?: string,
        useMSAL?: boolean,
        allowScopeLevelToken?: boolean,
        scopes?: any) {

        if (!Boolean(connectedServiceName) || typeof tenantId.valueOf() !== 'string') {
            throw new Error(tl.loc("serviceConnectionIdCannotBeEmpty"));
        }

        if (!Boolean(tenantId) || typeof tenantId.valueOf() !== 'string') {
            throw new Error(tl.loc("DomainCannotBeEmpty"));
        }

        if ((!scheme || scheme === 'ServicePrincipal')) {
            if (!Boolean(clientId) || typeof clientId.valueOf() !== 'string') {
                throw new Error(tl.loc("ClientIdCannotBeEmpty"));
            }

            if (!authType || authType == constants.AzureServicePrinicipalAuthentications.servicePrincipalKey) {
                if (!Boolean(secret) || typeof secret.valueOf() !== 'string') {
                    throw new Error(tl.loc("SecretCannotBeEmpty"));
                }
            }
            else {
                if (!Boolean(certFilePath) || typeof certFilePath.valueOf() !== 'string') {
                    throw new Error(tl.loc("InvalidCertFileProvided"));
                }
            }
        }

        if (!Boolean(baseUrl) || typeof baseUrl.valueOf() !== 'string') {
            throw new Error(tl.loc("armUrlCannotBeEmpty"));
        }

        if (!Boolean(authorityUrl) || typeof authorityUrl.valueOf() !== 'string') {
            throw new Error(tl.loc("authorityUrlCannotBeEmpty"));
        }

        if (!Boolean(activeDirectoryResourceId) || typeof activeDirectoryResourceId.valueOf() !== 'string') {
            throw new Error(tl.loc("activeDirectoryResourceIdUrlCannotBeEmpty"));
        }

        if (!Boolean(isAzureStackEnvironment) || typeof isAzureStackEnvironment.valueOf() != 'boolean') {
            isAzureStackEnvironment = false;
        }

        this.connectedServiceName = connectedServiceName;
        this.clientId = clientId;
        this.tenantId = tenantId;
        this.baseUrl = baseUrl;
        this.authorityUrl = authorityUrl;
        this.activeDirectoryResourceId = activeDirectoryResourceId;
        this.isAzureStackEnvironment = isAzureStackEnvironment;

        this.scheme = scheme ? AzureModels.Scheme[scheme] : AzureModels.Scheme['ServicePrincipal'];
        this.msiClientId = msiClientId;
        if (this.scheme == AzureModels.Scheme['ServicePrincipal']) {
            this.authType = authType ? authType : constants.AzureServicePrinicipalAuthentications.servicePrincipalKey;
            if (this.authType == constants.AzureServicePrinicipalAuthentications.servicePrincipalKey) {
                this.secret = secret;
            }
            else {
                this.certFilePath = certFilePath;
            }
        }

        this.isADFSEnabled = isADFSEnabled;
        this.accessToken = access_token;

        this.useMSAL = useMSAL;
        this.scopes = scopes;
        this.allowScopeLevelToken = allowScopeLevelToken || false;
        this.tokenMutex = new Mutex();
    }

    /**
     * @deprecated ADAL related methods are deprecated and will be removed.
     * Use Use `getMSALToken(force?: boolean)` instead.
     */
    public static getMSIAuthorizationToken(retyCount: number, timeToWait: number, baseUrl: string, msiClientId?: string): Q.Promise<string> {
        var deferred = Q.defer<string>();
        let webRequest = new webClient.WebRequest();
        webRequest.method = "GET";
        let apiVersion = "2018-02-01";
        const retryLimit = 5;
        msiClientId = msiClientId ? "&client_id=" + msiClientId : "";
        webRequest.uri = "http://169.254.169.254/metadata/identity/oauth2/token?api-version=" + apiVersion + "&resource=" + baseUrl + msiClientId;
        webRequest.headers = {
            "Metadata": true
        };

        webClient.sendRequest(webRequest).then(
            (response: webClient.WebResponse) => {
                if (response.statusCode == 200) {
                    deferred.resolve(response.body.access_token);
                }
                else if (response.statusCode == 429 || response.statusCode == 500) {
                    if (retyCount < retryLimit) {
                        let waitedTime = 2000 + timeToWait * 2;
                        retyCount += 1;
                        setTimeout(() => {
                            deferred.resolve(this.getMSIAuthorizationToken(retyCount, waitedTime, baseUrl, msiClientId));
                        }, waitedTime);
                    }
                    else {
                        deferred.reject(tl.loc('CouldNotFetchAccessTokenforMSIStatusCode', response.statusCode, response.statusMessage));
                    }
                }
                else {
                    deferred.reject(tl.loc('CouldNotFetchAccessTokenforMSIDueToMSINotConfiguredProperlyStatusCode', response.statusCode, response.statusMessage));
                }
            },
            (error) => {
                deferred.reject(error);
            }
        );

        return deferred.promise;
    }

    public getTenantId(): string {
        return this.tenantId;
    }

    public getClientId(): string {
        return this.clientId;
    }

    public getUseMSAL(): boolean {
        return this.useMSAL;
    }

    public async getToken(force?: boolean): Promise<string> {
        // run exclusively to prevent race conditions
        const release = await this.tokenMutex.acquire();

        try {
            const promisedTokenResult = this.getUseMSAL() ? this.getMSALToken(force) : this.getADALToken(force);
            return await promisedTokenResult;
        } finally {
            // release it for every situation
            release();
        }
    }

    private static async initOIDCToken(connection: WebApi, projectId: string, hub: string, planId: string, jobId: string, serviceConnectionId: string, retryCount: number = 0, timeToWait: number = 2000): Promise<string> {
        let error: any;
        for (let i = retryCount > 0 ? retryCount : 3; i > 0; i--) {
            try {
                const api = await connection.getTaskApi();
                const response = await api.createOidcToken({}, projectId, hub, planId, jobId, serviceConnectionId);
                if (response && response.oidcToken) {
                    tl.debug('Got OIDC token');
                    return response.oidcToken;
                }
            } catch (e: any) {
                error = e;
            }
            await new Promise(r => setTimeout(r, timeToWait));
            tl.debug(`Retrying OIDC token fetch. Retries left: ${i}`);
        }

        let message = tl.loc('CouldNotFetchAccessTokenforAAD');
        if (error) {
            message += " " + error;
        }

        return Promise.reject(new Error(message));
    }

    private static getSystemAccessToken() : string {
        tl.debug('Getting credentials for local feeds');
        const auth = tl.getEndpointAuthorization('SYSTEMVSSCONNECTION', false);
        if (auth.scheme === 'OAuth') {
            tl.debug('Got auth token');
            return auth.parameters['AccessToken'];
        }
        else {
            tl.warning('Could not determine credentials to use');
        }
    }

    // Extracted as its own (overridable) method purely so tests can simulate the Node <16 branch
    // of acquireTokenForScope without needing an actual Node 10 runtime.
    private supportsModernIdentity(): boolean {
        return nodeVersion >= 16;
    }

    private async getMSAL(): Promise<any> /*Promise<msal.ConfidentialClientApplication>*/ {
        // use same instance if it already exists
        if (!this.msalInstance) {
            this.msalInstance = await this.buildMSAL();
        }

        return this.msalInstance;
    }

    private getProxyClient(agentProxyURL: URL): any /*msal.INetworkModule*/ {
        let proxyURL = `${agentProxyURL.protocol}//${agentProxyURL.host}`;

        const agentProxyUsername: string = tl.getVariable("agent.proxyusername");
        const agentProxyPassword: string = tl.getVariable("agent.proxypassword");

        const encodedProxyUsername: string = agentProxyUsername ? encodeURIComponent(agentProxyUsername) : '';
        const encodedProxyPassword: string = agentProxyPassword ? encodeURIComponent(agentProxyPassword) : '';

        if (agentProxyUsername) {
            // basic auth
            proxyURL = `${agentProxyURL.protocol}//${encodedProxyUsername}:${encodedProxyPassword}@${agentProxyURL.host}`;
            tl.debug(`MSAL - Proxy setup with auth is: ${agentProxyURL.protocol}//${encodedProxyUsername}:***@${agentProxyURL.host}`);
        } else {
            // no auth
            tl.debug(`MSAL - Proxy setup with no-auth is: ${proxyURL}`);
        }

        // direct usage of msalConfig.system.proxyUrl is not available at the moment due to the fact that Object.fromEntries requires >=Node12
        const proxyAgent = new HttpsProxyAgent(proxyURL);

        const proxyNetworkClient: any /*msal.INetworkModule*/ = {
            async sendGetRequestAsync(url, options) {
                const customOptions = { ...options, ...{ method: "GET", agent: proxyAgent } }
                const response = await fetch(url, customOptions);
                return {
                    status: response.status,
                    headers: Object.create(Object.prototype, response.headers.raw()),
                    body: await response.json()
                }
            },
            async sendPostRequestAsync(url, options) {
                const customOptions = { ...options, ...{ method: "POST", agent: proxyAgent } }
                const response = await fetch(url, customOptions);
                return {
                    status: response.status,
                    headers: Object.create(Object.prototype, response.headers.raw()),
                    body: await response.json()
                }
            }
        };

        return proxyNetworkClient;
    }

    private async buildMSAL(): Promise<any> /*Promise<msal.ConfidentialClientApplication>*/ {
        // default configuration
        const authorityURL = (new URL(this.tenantId, this.authorityUrl)).toString();
        const isDebug = tl.getVariable("system.debug") && tl.getVariable("system.debug").toLowerCase() === "true";

        const msalConfig: any /*msal.Configuration*/ = {
            auth: {
                clientId: this.clientId,
                authority: authorityURL
            },
            system: {
                loggerOptions: {
                    loggerCallback(loglevel, message, _) {
                        loglevel === msal.LogLevel.Error ? tl.error(message) : tl.debug(message);
                    },
                    piiLoggingEnabled: isDebug,
                    logLevel: isDebug ? msal.LogLevel.Trace : msal.LogLevel.Info,
                }
            }
        };

        // proxy usage
        const agentProxyURL = tl.getVariable("agent.proxyurl") ? new URL(tl.getVariable("agent.proxyurl")) : null;
        const agentProxyBypassHosts = tl.getVariable("agent.proxybypasslist") ? JSON.parse(tl.getVariable("agent.proxybypasslist")) : [];

        const authorityHost = new URL(authorityURL).host;

        // same test logic is applied as typed-rest-client
        const bypassChecker = (elem) => elem && new RegExp(elem, 'i').test(authorityHost);
        const shouldProxyBypass = agentProxyBypassHosts.some(bypassChecker);

        if (agentProxyURL) {
            if (shouldProxyBypass) {
                tl.debug(`MSAL - Proxy is set but will be bypassed for ${authorityURL}`);
            } else {
                tl.debug('MSAL - Proxy will be used.');
                msalConfig.system.networkClient = this.getProxyClient(agentProxyURL);
            }
        }

        let msalInstance: any; //msal.ConfidentialClientApplication

        // setup msal according to parameters
        switch (this.scheme) {
            case AzureModels.Scheme.ManagedServiceIdentity:
                msalInstance = this.configureMSALWithMSI(msalConfig);
                break;
            case AzureModels.Scheme.WorkloadIdentityFederation:
                msalInstance = await this.configureMSALWithOIDC(msalConfig);
                break;
            case AzureModels.Scheme.SPN:
            default:
                msalInstance = this.configureMSALWithSP(msalConfig);
                break;
        }

        return msalInstance;
    }

    private configureMSALWithMSI(msalConfig: any /*msal.Configuration*/): any /*msal.ConfidentialClientApplication*/ {
        let accessTokenProvider: any /*msal.IAppTokenProvider*/ = (appTokenProviderParameters: any /*msal.AppTokenProviderParameters*/): Promise<any> /*Promise<msal.AppTokenProviderResult>*/ => {

            tl.debug("MSAL - ManagedIdentity is used.");

            let providerResultPromise = new Promise<any>/*Promise<msal.AppTokenProviderResult>*/((resolve, reject) => {
                // same for MSAL
                let webRequest = new webClient.WebRequest();
                webRequest.method = "GET";
                let apiVersion = "2018-02-01";
                // Preserve the legacy ARM resource unless scoped tokens are enabled.
                let resourceId = this.activeDirectoryResourceId;
                if (this.allowScopeLevelToken) {
                    const requestedScope = appTokenProviderParameters && appTokenProviderParameters.scopes
                        ? appTokenProviderParameters.scopes[0]
                        : undefined;
                    resourceId = this.getResourceIdFromScope(requestedScope);
                }
                webRequest.uri = "http://169.254.169.254/metadata/identity/oauth2/token?api-version=" + apiVersion + "&resource=" + resourceId;
                webRequest.headers = {
                    "Metadata": true
                };

                webClient.sendRequest(webRequest).then(
                    (response: webClient.WebResponse) => {
                        if (response.statusCode == 200) {
                            let providerResult: any /*msal.AppTokenProviderResult*/ = {
                                accessToken: response.body.access_token,
                                expiresInSeconds: response.body.expires_in
                            }
                            resolve(providerResult);
                        } else {
                            let errorMessage = tl.loc('CouldNotFetchAccessTokenforMSIStatusCode', response.statusCode, response.statusMessage);
                            reject({ errorCode: response.statusCode, errorMessage: errorMessage });
                        }
                    }, (error) => {
                        reject({ errorCode: "Unkown", errorMessage: error });
                    }
                );
            });

            return providerResultPromise;
        };

        // need to be set a value even, although it is not used (library requirement)
        msalConfig.auth.clientSecret = "dummy-value";
        let msalInstance = new msal.ConfidentialClientApplication(msalConfig);
        msalInstance.SetAppTokenProvider(accessTokenProvider);
        return msalInstance;
    }

    private getResourceIdFromScope(scope?: string): string {
        const defaultScopeSuffix = "/.default";
        return scope && scope.endsWith(defaultScopeSuffix)
            ? scope.substring(0, scope.length - defaultScopeSuffix.length)
            : this.activeDirectoryResourceId;
    }

    private configureMSALWithSP(msalConfig: any /*msal.Configuration*/): any /*msal.ConfidentialClientApplication*/ {
        switch (this.authType) {
            case constants.AzureServicePrinicipalAuthentications.servicePrincipalKey:
                tl.debug("MSAL - ServicePrincipal - clientSecret is used.");
                msalConfig.auth.clientSecret = this.secret;
                break;
            case constants.AzureServicePrinicipalAuthentications.servicePrincipalCertificate:
                tl.debug("MSAL - ServicePrincipal - certificate is used.");
                try {
                    const certFile = fs.readFileSync(this.certFilePath).toString();

                    // thumbprint
                    const certEncoded = certFile.match(/-----BEGIN CERTIFICATE-----\s*([\s\S]+?)\s*-----END CERTIFICATE-----/i)[1];
                    const certDecoded = Buffer.from(certEncoded, "base64");
                    // CodeQL [SM01510] External Dependency: Azure CLI generated certificates support only sha1 // CodeQL [SM04514] External Dependency: Azure CLI generated certificates support only sha1
                    const thumbprint = crypto.createHash("sha1").update(certDecoded).digest("hex").toUpperCase();

                    if (!thumbprint) {
                        throw new Error("MSAL - certificate - thumbprint couldn't be generated!");
                    }

                    tl.debug("MSAL - ServicePrincipal - certificate thumbprint creation is successful: " + thumbprint);

                    // privatekey
                    const privateKey = certFile.match(/-----BEGIN (.)*PRIVATE KEY-----\s*([\s\S]+?)\s*-----END (.)*PRIVATE KEY-----/i)[0];

                    if (!privateKey) {
                        throw new Error("MSAL - certificate - private key couldn't read!");
                    }

                    tl.debug("MSAL - ServicePrincipal - certificate private key reading is successful.");

                    msalConfig.auth.clientCertificate = {
                        thumbprint: thumbprint,
                        privateKey: privateKey
                    };
                } catch (error) {
                    throw new Error("MSAL - ServicePrincipal - certificate error: " + error);
                }
                break;
        }

        let msalInstance = new msal.ConfidentialClientApplication(msalConfig);
        return msalInstance;
    }

    public async getFederatedToken(): Promise<string> {
        const projectId: string = tl.getVariable('System.TeamProjectId');
        const hub: string = tl.getVariable('System.HostType');
        const planId: string = tl.getVariable('System.PlanId');
        const jobId: string = tl.getVariable('System.JobId');
        let uri = tl.getVariable('System.CollectionUri');

        if (!uri) {
            uri = tl.getVariable('System.TeamFoundationServerUri');
        }

        const token = ApplicationTokenCredentials.getSystemAccessToken();
        const authHandler = getHandlerFromToken(token);
        const connection = new WebApi(uri, authHandler);

        if (tl.getPipelineFeature("UseOIDCToken2InAzureArmRest")) {
            return azCliUtility.initOIDCToken2(connection, projectId, hub, planId, jobId, this.connectedServiceName);
        }

        const oidc_token: string = await ApplicationTokenCredentials.initOIDCToken(
            connection,
            projectId,
            hub,
            planId,
            jobId,
            this.connectedServiceName,
            3,
            2000);

        return oidc_token;
    }

    private async configureMSALWithOIDC(msalConfig: any /*msal.Configuration*/): Promise<any> /*Promise<msal.ConfidentialClientApplication>*/ {
        tl.debug('MSAL - FederatedAccess - OIDC is used.');

        msalConfig.auth.clientAssertion = await this.getFederatedToken();

        let msalInstance = new msal.ConfidentialClientApplication(msalConfig);
        return msalInstance;
    }

    // scopeOverride lets callers (e.g. acquireTokenForScope on Node <16, where @azure/identity is
    // unavailable) request a specific scope/audience via MSAL instead of the default ARM audience.
    // Callers must always pass one of our own hardcoded per-cloud entries from the `scopes` map
    // built in azure-arm-endpoint.ts (getScopesByEnvironment) - e.g. appservice:
    // 'https://appservice.azure.com/.default'. Those literals already include the "/.default"
    // suffix, so it is NOT appended again here (unlike the default activeDirectoryResourceId case
    // below, which is a bare resource URI and still needs the suffix).
    private async getMSALToken(force?: boolean, retryCount: number = 3, retryWaitMS: number = 2000, scopeOverride?: string): Promise<string> {
        tl.debug(`MSAL - getMSALToken called. force=${force}`);
        const msalApp: any /*msal.ConfidentialClientApplication*/ = await this.getMSAL();
        if (force) {
            msalApp.clearCache();
        }
        try {
            // Preserve the legacy ARM scope unless scoped tokens are enabled.
            const effectiveScopeOverride = this.allowScopeLevelToken ? scopeOverride : undefined;
            const request: any /*msal.ClientCredentialRequest*/ = {
                scopes: [effectiveScopeOverride || (this.activeDirectoryResourceId + "/.default")]
            };
            const response = await msalApp.acquireTokenByClientCredential(request);
            tl.debug(`MSAL - retrieved token - isFromCache?: ${response.fromCache}`);
            return response.accessToken;
        } catch (error) {
            if (retryCount > 0) {
                tl.debug(`MSAL - retrying getMSALToken - temporary error code: ${error.errorCode}`);
                tl.debug(`MSAL - retrying getMSALToken - remaining attempts: ${retryCount}`);

                await new Promise(r => setTimeout(r, Math.min(retryWaitMS, MAX_CREATE_AAD_TOKEN_BACKOFF_TIMEOUT)));
                return await this.getMSALToken(force, (retryCount - 1), retryWaitMS * 2, scopeOverride);
            }

            if (error.errorMessage && error.errorMessage.toString().startsWith("7000222")) {
                // Additional error message when clientSecret has been expired
                const organizationURL = tl.getVariable('System.CollectionUri');
                const projectName = tl.getVariable('System.TeamProject');
                const serviceConnectionLink = encodeURI(`${organizationURL}${projectName}/_settings/adminservices?resourceId=${this.connectedServiceName}`);

                throw new Error(tl.loc('ExpiredServicePrincipalMessageWithLink', serviceConnectionLink));
            } else {
                throw new Error(tl.loc('CouldNotFetchAccessTokenforAzureStatusCode', error.errorCode, error.errorMessage));
            }
        }
    }

    public async acquireTokenForScope(scopeKind: string): Promise<string> {
        tl.debug(`acquireTokenForScope called with scopeKind: ${scopeKind}`);
        try {
            if (this.allowScopeLevelToken && this.scopes && this.scopes[scopeKind]) {
                tl.debug(`allowScopeLevelToken is enabled, using scope: ${this.scopes[scopeKind]}`);
                if (!this.supportsModernIdentity()) {
                    // @azure/identity requires Node 16+, but MSAL (msalv1) already supports SPN,
                    // MSI, and WIF client-credential flows on Node 10. Request the same mapped
                    // scope/audience through MSAL instead of falling back to the ARM audience, so
                    // Node 10 agents get a genuine App Service-scoped token, not a compromise.
                    tl.debug(`Node ${nodeVersion} detected; using MSAL to acquire scoped token instead of @azure/identity.`);
                    const token = await this.getMSALToken(false, 3, 2000, this.scopes[scopeKind]);
                    // acquireTokenForScope is only ever called for the App Service/Kudu scenario
                    // (scopeKind is always "appservice"), so telemetry only needs to distinguish
                    // this narrow case - not every possible _azureScopes key.
                    this.publishScopeTokenTelemetry(scopeKind, "AppService", "scoped");
                    return token;
                }
                const credentialInfo = await this.buildCredentialByScheme();
                try {
                    const tokenResponse = await credentialInfo.credential.getToken(this.scopes[scopeKind]);
                    this.publishScopeTokenTelemetry(scopeKind, "AppService", "scoped");
                    return tokenResponse.token;
                } finally {
                    this.deleteFederatedTokenFile(credentialInfo.tokenFilePath);
                }
            } else {
                let outcome: string;
                if (this.allowScopeLevelToken && (!this.scopes || !this.scopes[scopeKind])) {
                    // The scope-level token feature is enabled but no scope is mapped for this
                    // cloud/scopeKind (e.g. an unregistered sovereign cloud). We deliberately fall
                    // back to the ARM-audience token to preserve deployment functionality, but log
                    // a warning so this is observable - a Kudu call receiving an ARM-audience token
                    // is exactly what this feature aims to eliminate. authorityUrl (a public login
                    // endpoint, not a secret) is logged to help identify the cloud.
                    tl.warning(`acquireTokenForScope: no '${scopeKind}' scope is mapped for this environment (authority: ${this.authorityUrl}); falling back to an ARM-audience token.`);
                    outcome = "fallbackUnmapped";
                } else {
                    tl.debug(`allowScopeLevelToken is disabled`);
                    outcome = "fallbackDisabled";
                }
                const token = await this.getToken();
                this.publishScopeTokenTelemetry(scopeKind, "ARM", outcome);
                return token;
            }
        } catch (error) {
            tl.debug(`acquireTokenForScopes - error: ${error}`);
            this.publishScopeTokenTelemetry(scopeKind, "None", "error");
            throw new Error(tl.loc('CouldNotFetchAccessTokenforAzureStatusCode', error.errorCode, error.errorMessage));
        }
    }

    // Emits non-sensitive telemetry so we can prove Kudu/SCM calls request an App Service-audience
    // token (and detect any ARM-audience fallback) once ALLOWSCOPELEVELTOKEN is rolled out. Only
    // metadata is recorded - never a token, secret, or credential material. authorityHost is a
    // public Entra login endpoint used to identify the cloud.
    private publishScopeTokenTelemetry(scopeKind: string, requestedAudience: string, outcome: string): void {
        if (!this.allowScopeLevelToken) {
            return;
        }

        // Remember the most recent decision so getLastScopeTokenTelemetry() can expose it to the
        // Kudu auth layer for the unified KuduAuthMode event. Existing events below are unchanged.
        this._lastRequestedAudience = requestedAudience;
        this._lastScopeOutcome = outcome;
        try {
            let authorityHost = "";
            try {
                authorityHost = this.authorityUrl ? new URL(this.authorityUrl).host : "";
            } catch (e) {
                authorityHost = "";
            }
            const payload = {
                scopeKind: scopeKind,
                requestedAudience: requestedAudience,
                outcome: outcome,
                allowScopeLevelToken: !!this.allowScopeLevelToken,
                // this.scheme is undefined for the service-principal case (the constructor maps
                // the endpoint's "ServicePrincipal" scheme against an enum that only defines
                // ManagedServiceIdentity/SPN/WorkloadIdentityFederation), so default to
                // "ServicePrincipal" instead of emitting an empty field.
                scheme: this.scheme === undefined ? "ServicePrincipal" : AzureModels.Scheme[this.scheme],
                authorityHost: authorityHost
            };
            console.log(`##vso[telemetry.publish area=TaskDeploymentMethod;feature=KuduScopeLevelToken]${JSON.stringify(payload)}`);

            // Dedicated, stable signal for a production monitor. Whenever a Kudu/SCM call still
            // receives an ARM-audience token we emit KuduArmTokenDeprecated so adoption of the
            // scoped path can be measured (and the ARM path safely retired) later. Kept silent -
            // no customer-facing warning - because the ARM fallback is still the expected behavior
            // while ALLOWSCOPELEVELTOKEN is rolling out; a warning here would be noise.
            if (requestedAudience === "ARM") {
                const deprecationPayload = {
                    source: "azure-arm-rest",
                    reason: outcome,
                    authorityHost: authorityHost
                };
                console.log(`##vso[telemetry.publish area=TaskDeploymentMethod;feature=KuduArmTokenDeprecated]${JSON.stringify(deprecationPayload)}`);
                tl.debug(`[deprecation] Kudu/SCM received an ARM-audience token (reason=${outcome}). This path is deprecated and will be removed once ALLOWSCOPELEVELTOKEN is fully enabled.`);
            }
        } catch (e) {
            tl.debug(`Failed to publish scope token telemetry: ${e}`);
        }
    }

    // Exposes non-sensitive metadata about the most recent scoped-token decision so the Kudu auth
    // layer can publish a single, unified auth-mode telemetry event (basic vs scoped vs broad).
    // requestedAudience/outcome are undefined until acquireTokenForScope has run (e.g. the Basic
    // auth path never calls it); allowScopeLevelToken/scheme/authorityHost are always meaningful.
    public getLastScopeTokenTelemetry(): { requestedAudience: string, outcome: string, allowScopeLevelToken: boolean, scheme: string, authorityHost: string } {
        let authorityHost = "";
        try {
            authorityHost = this.authorityUrl ? new URL(this.authorityUrl).host : "";
        } catch (e) {
            authorityHost = "";
        }
        return {
            requestedAudience: this._lastRequestedAudience,
            outcome: this._lastScopeOutcome,
            allowScopeLevelToken: !!this.allowScopeLevelToken,
            scheme: this.scheme === undefined ? "ServicePrincipal" : AzureModels.Scheme[this.scheme],
            authorityHost: authorityHost
        };
    }

    private async buildCredentialByScheme(): Promise<any> {
        tl.debug(`buildCredentialByScheme called. scheme = ${AzureModels.Scheme[this.scheme]}`);
        
        if (!azureIdentity) {
            throw new Error(`@azure/identity is not supported on Node ${nodeVersion}. Please use Node 16 or higher for this authentication scheme.`);
        }

        // Point @azure/identity credentials at the service connection's Entra authority so that
        // scope-level tokens are requested from the correct (sovereign) cloud instead of the
        // public login.microsoftonline.com default. this.authorityUrl carries the per-cloud
        // authority (e.g. login.microsoftonline.us / login.chinacloudapi.cn) and is the same
        // value the ARM/MSAL path derives its authority from (see buildMSAL).
        const credentialOptions = { authorityHost: this.authorityUrl };

        switch (this.scheme) {
            case AzureModels.Scheme.ManagedServiceIdentity:
                tl.debug('Using ManagedIdentityCredential for MSI');
                return {
                    credential: new azureIdentity.ManagedIdentityCredential(this.msiClientId)
                };

            case AzureModels.Scheme.WorkloadIdentityFederation:
                tl.debug('Using WorkloadIdentityCredential for OIDC');
                const federatedToken = await this.getFederatedToken();
                // Use a unique file name per invocation. A fixed 'token.jwt' name races when
                // multiple credentials are built concurrently in the same job (e.g. parallel
                // slot deployments), where one write can clobber another's federated token.
                const tokenFilePath = path.join(
                    tl.getVariable('Agent.TempDirectory') || tl.getVariable('system.DefaultWorkingDirectory'),
                    `token-${crypto.randomBytes(16).toString('hex')}.jwt`
                );
                try {
                    fs.writeFileSync(tokenFilePath, federatedToken);
                    return {
                        credential: new azureIdentity.WorkloadIdentityCredential({
                            ...credentialOptions,
                            tenantId: this.tenantId,
                            clientId: this.clientId,
                            tokenFilePath: tokenFilePath
                        }),
                        tokenFilePath: tokenFilePath
                    };
                } catch (error) {
                    this.deleteFederatedTokenFile(tokenFilePath);
                    throw error;
                }

            case AzureModels.Scheme.SPN:
            default:
                tl.debug('Using specific credential for Service Principal');
                if (this.authType === constants.AzureServicePrinicipalAuthentications.servicePrincipalKey) {
                    tl.debug('Using ClientSecretCredential for key-based SPN');
                    return {
                        credential: new azureIdentity.ClientSecretCredential(this.tenantId, this.clientId, this.secret, credentialOptions)
                    };
                } else {
                    tl.debug('Using ClientCertificateCredential for certificate-based SPN');
                    return {
                        credential: new azureIdentity.ClientCertificateCredential(this.tenantId, this.clientId, this.certFilePath, credentialOptions)
                    };
                }
        }
    }

    private deleteFederatedTokenFile(tokenFilePath?: string): void {
        if (!tokenFilePath || !fs.existsSync(tokenFilePath)) {
            return;
        }

        try {
            fs.unlinkSync(tokenFilePath);
            this.publishFederatedTokenFileCleanupTelemetry("deleted");
        } catch (error) {
            tl.warning("Failed to delete the federated token file after token acquisition.");
            tl.debug(`Failed to delete federated token file '${tokenFilePath}': ${error}`);
            this.publishFederatedTokenFileCleanupTelemetry("error");
        }
    }

    private publishFederatedTokenFileCleanupTelemetry(outcome: string): void {
        if (!this.allowScopeLevelToken) {
            return;
        }

        try {
            console.log(`##vso[telemetry.publish area=TaskDeploymentMethod;feature=FederatedTokenFileCleanup]${JSON.stringify({ outcome: outcome })}`);
        } catch (error) {
            tl.debug(`Failed to publish federated token file cleanup telemetry: ${error}`);
        }
    }

    /**
     * @deprecated ADAL related methods are deprecated and will be removed.
     * Use Use `getMSALToken(force?: boolean)` instead.
     */
    private getADALToken(force?: boolean): Q.Promise<string> {
        if (!!this.accessToken && !force) {
            tl.debug("==================== USING ENDPOINT PROVIDED ACCESS TOKEN ====================");
            let deferred = Q.defer<string>();
            deferred.resolve(this.accessToken);
            return deferred.promise;
        }

        if (!this.token_deferred || force) {
            if (this.scheme === AzureModels.Scheme.ManagedServiceIdentity) {
                this.token_deferred = ApplicationTokenCredentials.getMSIAuthorizationToken(0, 0, this.baseUrl, this.msiClientId);
            }
            else {
                this.token_deferred = this._getSPNAuthorizationToken();
            }
        }

        return this.token_deferred;
    }

    /**
     * @deprecated ADAL related methods are deprecated and will be removed.
     * Use Use `getMSALToken(force?: boolean)` instead.
     */
    private _getSPNAuthorizationToken(): Q.Promise<string> {
        if (this.authType == constants.AzureServicePrinicipalAuthentications.servicePrincipalKey) {
            return this._getSPNAuthorizationTokenFromKey();
        }

        return this._getSPNAuthorizationTokenFromCertificate()
    }

    /**
     * @deprecated ADAL related methods are deprecated and will be removed.
     * Use Use `getMSALToken(force?: boolean)` instead.
     */
    private _getSPNAuthorizationTokenFromCertificate(): Q.Promise<string> {
        var deferred = Q.defer<string>();
        let webRequest = new webClient.WebRequest();
        webRequest.method = "POST";
        webRequest.uri = this.authorityUrl + (this.isADFSEnabled ? "" : this.tenantId) + "/oauth2/token/";
        webRequest.body = querystring.stringify({
            resource: this.activeDirectoryResourceId,
            client_id: this.clientId,
            grant_type: "client_credentials",
            client_assertion: this._getSPNCertificateAuthorizationToken(),
            client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
        });

        let webRequestOptions: webClient.WebRequestOptions = {
            retriableErrorCodes: null,
            retriableStatusCodes: [400, 408, 409, 429, 500, 502, 503, 504],
            retryCount: null,
            retryIntervalInSeconds: null,
            retryRequestTimedout: null
        };

        webClient.sendRequest(webRequest, webRequestOptions).then(
            (response: webClient.WebResponse) => {
                if (response.statusCode == 200) {
                    deferred.resolve(response.body.access_token);
                }
                else if ([400, 401, 403].indexOf(response.statusCode) != -1) {
                    deferred.reject(tl.loc('ExpiredServicePrincipal'));
                }
                else {
                    deferred.reject(tl.loc('CouldNotFetchAccessTokenforAzureStatusCode', response.statusCode, response.statusMessage));
                }
            },
            (error) => {
                deferred.reject(error)
            }
        );
        return deferred.promise;
    }

    /**
     * @deprecated ADAL related methods are deprecated and will be removed.
     * Use Use `getMSALToken(force?: boolean)` instead.
     */
    private _getSPNAuthorizationTokenFromKey(): Q.Promise<string> {
        var deferred = Q.defer<string>();
        let webRequest = new webClient.WebRequest();
        webRequest.method = "POST";
        webRequest.uri = this.authorityUrl + (this.isADFSEnabled ? "" : this.tenantId) + "/oauth2/token/";
        webRequest.body = querystring.stringify({
            resource: this.activeDirectoryResourceId,
            client_id: this.clientId,
            grant_type: "client_credentials",
            client_secret: this.secret
        });
        webRequest.headers = {
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8"
        };

        let webRequestOptions: webClient.WebRequestOptions = {
            retriableErrorCodes: null,
            retriableStatusCodes: [400, 403, 408, 409, 429, 500, 502, 503, 504],
            retryCount: null,
            retryIntervalInSeconds: null,
            retryRequestTimedout: null
        };

        webClient.sendRequest(webRequest, webRequestOptions).then(
            (response: webClient.WebResponse) => {
                if (response.statusCode == 200) {
                    deferred.resolve(response.body.access_token);
                }
                else if ([400, 401, 403].indexOf(response.statusCode) != -1) {
                    deferred.reject(tl.loc('ExpiredServicePrincipal'));
                }
                else {
                    deferred.reject(tl.loc('CouldNotFetchAccessTokenforAzureStatusCode', response.statusCode, response.statusMessage));
                }
            },
            (error) => {
                deferred.reject(error)
            }
        );

        return deferred.promise;
    }

    public getOpenSSLPath() {
        if (tl.osType().match(/^Win/)) {
            if (tl.getPipelineFeature("UseLatestOpenSSLInAzureArmRest")) {
                return tl.which(path.join(__dirname, 'openssl3.5.8', 'openssl'));
            } else {
                return tl.which(path.join(__dirname, 'openssl3.4.2', 'openssl'));
            }
        } else {
            return tl.which('openssl');
        }
    }

    /**
     * @deprecated ADAL related methods are deprecated and will be removed.
     * Use Use `getMSALToken(force?: boolean)` instead.
     */
    private _getSPNCertificateAuthorizationToken(): string {
        var openSSLPath = this.getOpenSSLPath();
        var openSSLArgsArray = [
            "x509",
            "-sha1",
            "-noout",
            "-in",
            this.certFilePath,
            "-fingerprint"
        ];
        tl.debug(`The OpenSSL version is ${tl.execSync(openSSLPath, 'version')}`);
        var pemExecutionResult = tl.execSync(openSSLPath, openSSLArgsArray);
        var additionalHeaders = {
            "alg": "RS256",
            "typ": "JWT",
        };

        if (pemExecutionResult.code == 0) {
            tl.debug("FINGERPRINT CREATION SUCCESSFUL");
            let shaFingerprint = pemExecutionResult.stdout;
            let shaFingerPrintHashCode = shaFingerprint.split("=")[1].replace(new RegExp(":", 'g'), "");
            let fingerPrintHashBase64: string = Buffer.from(
                shaFingerPrintHashCode.match(/\w{2}/g).map(function (a) {
                    return String.fromCharCode(parseInt(a, 16));
                }).join(""),
                'binary'
            ).toString('base64');
            additionalHeaders["x5t"] = fingerPrintHashBase64;
        }
        else {
            console.log(pemExecutionResult);
            throw new Error(pemExecutionResult.stderr);
        }

        return getJWT(this.authorityUrl, this.clientId, this.tenantId, this.certFilePath, additionalHeaders, this.isADFSEnabled);
    }
}

/**
 * @deprecated ADAL related methods are deprecated and will be removed.
 * Use Use `getMSALToken(force?: boolean)` instead.
 */
function getJWT(url: string, clientId: string, tenantId: string, pemFilePath: string, additionalHeaders, isADFSEnabled: boolean) {

    var pemFileContent = fs.readFileSync(pemFilePath);
    var jwtObject = {
        "aud": (`${url}/${!isADFSEnabled ? tenantId : ""}/oauth2/token`).replace(/([^:]\/)\/+/g, "$1"),
        "iss": clientId,
        "sub": clientId,
        "jti": "" + Math.random(),
        "nbf": (Math.floor(Date.now() / 1000) - 1000),
        "exp": (Math.floor(Date.now() / 1000) + 8640000)
    };

    var token = jwt.sign(jwtObject, pemFileContent, { algorithm: 'RS256', header: additionalHeaders });
    return token;
}
