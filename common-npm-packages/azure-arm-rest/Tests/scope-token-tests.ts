import assert = require("assert");
import { ApplicationTokenCredentials } from '../azure-arm-common';
import { publishKuduAuthModeTelemetry } from '../azureAppServiceUtility';
import { getMockEndpoint, nock } from './mock_utils';
import fs = require('fs');
import os = require('os');
import path = require('path');
import tl = require('azure-pipelines-task-lib/task');

const azureIdentity = require("@azure/identity");
const scopeFeatureVariable = "DISTRIBUTEDTASK_TASKS_ALLOWSCOPELEVELTOKEN";
const proxyEnvironmentVariables = [
    "AGENT_PROXYURL",
    "AGENT_PROXYUSERNAME",
    "AGENT_PROXYPASSWORD",
    "AGENT_PROXYBYPASSLIST"
];

// Installs the ARM (ADAL) nock interceptor that answers the client-credentials token
// request with "DUMMY_ACCESS_TOKEN". This is the ARM-audience token that acquireTokenForScope
// must return whenever it falls back (feature disabled or scope unmapped).
getMockEndpoint();

// Builds a Service Principal (key) credential wired to the same tenant/authority/secret the
// mock nock interceptor expects. useMSAL=false forces the ADAL path so getToken() is served
// by nock rather than a real network/MSAL call.
function makeCreds(allowScopeLevelToken: boolean, scopes: any): ApplicationTokenCredentials {
    return new ApplicationTokenCredentials(
        "MOCK_SERVICE_CONNECTION",
        "MOCK_SPN_ID",
        "MOCK_TENANT_ID",
        "MOCK_SPN_KEY",
        "https://management.azure.com/",
        "https://login.windows.net/",
        "https://management.azure.com/",
        false,
        undefined,   // scheme -> ServicePrincipal
        undefined,   // msiClientId
        undefined,   // authType -> servicePrincipalKey
        undefined,   // certFilePath
        undefined,   // isADFSEnabled
        undefined,   // access_token
        false,       // useMSAL -> ADAL path (served by nock)
        allowScopeLevelToken,
        scopes
    );
}

function makeManagedIdentityCreds(allowScopeLevelToken = true): any {
    return new ApplicationTokenCredentials(
        "MOCK_SERVICE_CONNECTION",
        undefined,
        "MOCK_TENANT_ID",
        undefined,
        "https://management.azure.com/",
        "https://login.windows.net/",
        "https://management.azure.com/",
        false,
        "ManagedServiceIdentity",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        allowScopeLevelToken,
        { appservice: "https://appservice/.default" }
    );
}

class ScopeTokenTests {
    // Feature enabled and scope mapped -> returns the App Service-audience token.
    public static async scopedTokenSuccess() {
        try {
            process.env[scopeFeatureVariable] = "true";
            const creds: any = makeCreds(true, { appservice: "https://appservice/.default" });
            creds.buildCredentialByScheme = async () => ({
                credential: {
                    getToken: async (scope: string) => {
                        if (scope !== "https://appservice/.default") {
                            throw new Error("unexpected scope");
                        }
                        return { token: "DUMMY_APPSERVICE_TOKEN" };
                    }
                }
            });
            const token = await creds.acquireTokenForScope("appservice");
            console.log('SCOPED_TOKEN: ' + token);
        } catch (error) {
            console.log(error);
            tl.setResult(tl.TaskResult.Failed, 'scopedTokenSuccess should have passed but failed');
        }
    }

    public static async authenticatedProxyOptions() {
        const originalProxyEnvironment = ScopeTokenTests.captureProxyEnvironment();
        try {
            process.env["AGENT_PROXYURL"] = "http://proxy.example.test:8080";
            process.env["AGENT_PROXYUSERNAME"] = "proxy-user";
            process.env["AGENT_PROXYPASSWORD"] = "proxy-password";
            process.env["AGENT_PROXYBYPASSLIST"] = "[]";

            const creds: any = makeCreds(true, { appservice: "https://appservice/.default" });
            const options = creds.getCredentialOptions();

            assert.deepStrictEqual(options, {
                authorityHost: "https://login.windows.net/",
                proxyOptions: {
                    host: "http://proxy.example.test",
                    port: 8080,
                    username: "proxy-user",
                    password: "proxy-password"
                }
            });
            console.log("AUTHENTICATED_PROXY_OPTIONS: applied");
        } catch (error) {
            console.log(error);
            tl.setResult(tl.TaskResult.Failed, 'authenticatedProxyOptions should have passed but failed');
        } finally {
            ScopeTokenTests.restoreProxyEnvironment(originalProxyEnvironment);
        }
    }

    public static async credentialConstructorsReceiveProxyOptions() {
        const originalProxyEnvironment = ScopeTokenTests.captureProxyEnvironment();
        const originalAgentTempDirectory = process.env["AGENT_TEMPDIRECTORY"];
        const originalDescriptors = {
            WorkloadIdentityCredential: Object.getOwnPropertyDescriptor(azureIdentity, "WorkloadIdentityCredential"),
            ClientSecretCredential: Object.getOwnPropertyDescriptor(azureIdentity, "ClientSecretCredential"),
            ClientCertificateCredential: Object.getOwnPropertyDescriptor(azureIdentity, "ClientCertificateCredential")
        };
        let tempDirectory: string;
        let workloadIdentityOptions: any;
        let clientSecretOptions: any;
        let clientCertificateOptions: any;

        try {
            process.env["AGENT_PROXYURL"] = "http://proxy.example.test:8080";
            process.env["AGENT_PROXYUSERNAME"] = "proxy-user";
            process.env["AGENT_PROXYPASSWORD"] = "proxy-password";
            process.env["AGENT_PROXYBYPASSLIST"] = "[]";
            tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "azure-arm-rest-proxy-"));
            process.env["AGENT_TEMPDIRECTORY"] = tempDirectory;

            Object.defineProperty(azureIdentity, "WorkloadIdentityCredential", {
                configurable: true,
                value: class {
                    constructor(options: any) {
                        workloadIdentityOptions = options;
                    }
                }
            });
            Object.defineProperty(azureIdentity, "ClientSecretCredential", {
                configurable: true,
                value: class {
                    constructor(_tenantId: string, _clientId: string, _secret: string, options: any) {
                        clientSecretOptions = options;
                    }
                }
            });
            Object.defineProperty(azureIdentity, "ClientCertificateCredential", {
                configurable: true,
                value: class {
                    constructor(_tenantId: string, _clientId: string, _certificatePath: string, options: any) {
                        clientCertificateOptions = options;
                    }
                }
            });

            const workloadIdentityCreds: any = new ApplicationTokenCredentials(
                "MOCK_SERVICE_CONNECTION",
                "MOCK_SPN_ID",
                "MOCK_TENANT_ID",
                undefined,
                "https://management.azure.com/",
                "https://login.windows.net/",
                "https://management.azure.com/",
                false,
                "WorkloadIdentityFederation",
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                true,
                true,
                { appservice: "https://appservice/.default" }
            );
            workloadIdentityCreds.getFederatedToken = async () => "DUMMY_FEDERATED_TOKEN";
            const workloadIdentityCredential = await workloadIdentityCreds.buildCredentialByScheme();
            workloadIdentityCreds.deleteFederatedTokenFile(workloadIdentityCredential.tokenFilePath);

            const clientSecretCreds: any = makeCreds(true, { appservice: "https://appservice/.default" });
            await clientSecretCreds.buildCredentialByScheme();

            const clientCertificateCreds: any = new ApplicationTokenCredentials(
                "MOCK_SERVICE_CONNECTION",
                "MOCK_SPN_ID",
                "MOCK_TENANT_ID",
                undefined,
                "https://management.azure.com/",
                "https://login.windows.net/",
                "https://management.azure.com/",
                false,
                "ServicePrincipal",
                undefined,
                "spnCertificate",
                "MOCK_CERTIFICATE_PATH",
                undefined,
                undefined,
                true,
                true,
                { appservice: "https://appservice/.default" }
            );
            await clientCertificateCreds.buildCredentialByScheme();

            const expectedProxyOptions = {
                host: "http://proxy.example.test",
                port: 8080,
                username: "proxy-user",
                password: "proxy-password"
            };
            assert.deepStrictEqual(workloadIdentityOptions.proxyOptions, expectedProxyOptions);
            assert.deepStrictEqual(clientSecretOptions.proxyOptions, expectedProxyOptions);
            assert.deepStrictEqual(clientCertificateOptions.proxyOptions, expectedProxyOptions);
            console.log("PROXY_CONSTRUCTOR_OPTIONS: applied");
        } catch (error) {
            console.log(error);
            tl.setResult(tl.TaskResult.Failed, 'credentialConstructorsReceiveProxyOptions should have passed but failed');
        } finally {
            Object.defineProperty(azureIdentity, "WorkloadIdentityCredential", originalDescriptors.WorkloadIdentityCredential);
            Object.defineProperty(azureIdentity, "ClientSecretCredential", originalDescriptors.ClientSecretCredential);
            Object.defineProperty(azureIdentity, "ClientCertificateCredential", originalDescriptors.ClientCertificateCredential);
            ScopeTokenTests.restoreProxyEnvironment(originalProxyEnvironment);
            if (originalAgentTempDirectory === undefined) {
                delete process.env["AGENT_TEMPDIRECTORY"];
            } else {
                process.env["AGENT_TEMPDIRECTORY"] = originalAgentTempDirectory;
            }
            if (tempDirectory && fs.existsSync(tempDirectory)) {
                fs.rmdirSync(tempDirectory);
            }
        }
    }

    public static async proxyDefaultPorts() {
        const originalProxyEnvironment = ScopeTokenTests.captureProxyEnvironment();
        try {
            process.env["AGENT_PROXYUSERNAME"] = "";
            process.env["AGENT_PROXYPASSWORD"] = "";
            process.env["AGENT_PROXYBYPASSLIST"] = "[]";

            process.env["AGENT_PROXYURL"] = "http://proxy.example.test";
            const httpCreds: any = makeCreds(true, { appservice: "https://appservice/.default" });
            assert.strictEqual(httpCreds.getCredentialOptions().proxyOptions.port, 80);

            process.env["AGENT_PROXYURL"] = "https://proxy.example.test";
            const httpsCreds: any = makeCreds(true, { appservice: "https://appservice/.default" });
            assert.strictEqual(httpsCreds.getCredentialOptions().proxyOptions.port, 443);

            console.log("PROXY_DEFAULT_PORTS: http=80 https=443");
        } catch (error) {
            console.log(error);
            tl.setResult(tl.TaskResult.Failed, 'proxyDefaultPorts should have passed but failed');
        } finally {
            ScopeTokenTests.restoreProxyEnvironment(originalProxyEnvironment);
        }
    }

    public static async bypassedProxyOptions() {
        const originalProxyEnvironment = ScopeTokenTests.captureProxyEnvironment();
        try {
            process.env["AGENT_PROXYURL"] = "http://proxy.example.test:8080";
            process.env["AGENT_PROXYUSERNAME"] = "proxy-user";
            process.env["AGENT_PROXYPASSWORD"] = "proxy-password";
            process.env["AGENT_PROXYBYPASSLIST"] = JSON.stringify(["login\\.windows\\.net"]);

            const creds: any = makeCreds(true, { appservice: "https://appservice/.default" });
            const options = creds.getCredentialOptions();

            assert.strictEqual(options.proxyOptions, undefined,
                "Proxy options should be omitted when task-lib matches the authority URL to the bypass list");
            console.log("BYPASSED_PROXY_OPTIONS: omitted");
        } catch (error) {
            console.log(error);
            tl.setResult(tl.TaskResult.Failed, 'bypassedProxyOptions should have passed but failed');
        } finally {
            ScopeTokenTests.restoreProxyEnvironment(originalProxyEnvironment);
        }
    }

    public static async noProxyOptions() {
        const originalProxyEnvironment = ScopeTokenTests.captureProxyEnvironment();
        try {
            proxyEnvironmentVariables.forEach(variable => delete process.env[variable]);

            const creds: any = makeCreds(true, { appservice: "https://appservice/.default" });
            const options = creds.getCredentialOptions();

            assert.strictEqual(options.proxyOptions, undefined,
                "Proxy options should be omitted when the agent has no proxy configuration");
            console.log("NO_PROXY_OPTIONS: omitted");
        } catch (error) {
            console.log(error);
            tl.setResult(tl.TaskResult.Failed, 'noProxyOptions should have passed but failed');
        } finally {
            ScopeTokenTests.restoreProxyEnvironment(originalProxyEnvironment);
        }
    }

    public static async featureDisabledDoesNotReadProxy() {
        const taskLib: any = tl;
        const originalGetHttpProxyConfiguration = taskLib.getHttpProxyConfiguration;
        try {
            taskLib.getHttpProxyConfiguration = () => {
                throw new Error("Flag-off behavior must not read proxy configuration for Azure Identity");
            };

            const creds = makeCreds(false, undefined);
            const token = await creds.acquireTokenForScope("appservice");
            assert.strictEqual(token, "DUMMY_ACCESS_TOKEN");
            console.log("FEATURE_DISABLED_PROXY_READ: false");
        } catch (error) {
            console.log(error);
            tl.setResult(tl.TaskResult.Failed, 'featureDisabledDoesNotReadProxy should have passed but failed');
        } finally {
            taskLib.getHttpProxyConfiguration = originalGetHttpProxyConfiguration;
        }
    }

    // Feature disabled -> returns the ARM-audience token, no warning.
    public static async fallbackWhenFeatureDisabled() {
        const originalLog = console.log;
        let emittedScopeTelemetry = false;
        try {
            process.env[scopeFeatureVariable] = "false";
            console.log = (...args: any[]) => {
                if (args.join(" ").indexOf("feature=KuduScopeLevelToken") >= 0) {
                    emittedScopeTelemetry = true;
                }
                originalLog.apply(console, args);
            };
            const creds = makeCreds(false, undefined);
            const token = await creds.acquireTokenForScope("appservice");
            originalLog('FALLBACK_DISABLED_TOKEN: ' + token);
        } catch (error) {
            originalLog(error);
            tl.setResult(tl.TaskResult.Failed, 'fallbackWhenFeatureDisabled should have passed but failed');
        } finally {
            console.log = originalLog;
            originalLog('FALLBACK_DISABLED_TELEMETRY: ' + emittedScopeTelemetry);
            process.env[scopeFeatureVariable] = "true";
        }
    }

    // Feature enabled but no scope mapped for this environment -> warns, then falls back to ARM.
    public static async fallbackWhenScopeUnmapped() {
        try {
            process.env[scopeFeatureVariable] = "true";
            const creds = makeCreds(true, {}); // no 'appservice' key
            const token = await creds.acquireTokenForScope("appservice");
            console.log('FALLBACK_UNMAPPED_TOKEN: ' + token);
        } catch (error) {
            console.log(error);
            tl.setResult(tl.TaskResult.Failed, 'fallbackWhenScopeUnmapped should have passed but failed');
        }
    }

    // Feature enabled and scope mapped, but running on Node <16 (@azure/identity unavailable) ->
    // uses MSAL (getMSALToken) with the mapped scope instead, still returns the App
    // Service-audience token, no ARM compromise.
    public static async scopedTokenSuccessOnLegacyNode() {
        try {
            process.env[scopeFeatureVariable] = "true";
            const creds: any = makeCreds(true, { appservice: "https://appservice/.default" });
            creds.supportsModernIdentity = () => false;
            creds.getMSALToken = async (_force: boolean, _retryCount: number, _retryWaitMS: number, scopeOverride: string) => {
                if (scopeOverride !== "https://appservice/.default") {
                    throw new Error("unexpected scope passed to getMSALToken");
                }
                return "DUMMY_APPSERVICE_TOKEN_VIA_MSAL";
            };
            const token = await creds.acquireTokenForScope("appservice");
            console.log('SCOPED_TOKEN_LEGACY_NODE: ' + token);
        } catch (error) {
            console.log(error);
            tl.setResult(tl.TaskResult.Failed, 'scopedTokenSuccessOnLegacyNode should have passed but failed');
        }
    }

    // Managed Identity uses the requested scope's resource instead of always requesting ARM.
    public static async managedIdentityScopeResource() {
        try {
            nock("http://169.254.169.254", {
                reqheaders: {
                    "Metadata": true
                }
            })
                .get("/metadata/identity/oauth2/token")
                .query({
                    "api-version": "2018-02-01",
                    "resource": "https://appservice"
                })
                .reply(200, {
                    access_token: "DUMMY_APPSERVICE_TOKEN_FROM_MSI",
                    expires_in: 3600
                });

            const creds = makeManagedIdentityCreds();
            const msalClient = await creds.buildMSAL();
            const result = await msalClient.acquireTokenByClientCredential({
                scopes: ["https://appservice/.default"]
            });
            if (result.accessToken !== "DUMMY_APPSERVICE_TOKEN_FROM_MSI") {
                throw new Error(`unexpected Managed Identity token: ${result.accessToken}`);
            }
            console.log('MSI_SCOPE_RESOURCE: https://appservice');
        } catch (error) {
            console.log(error);
            tl.setResult(tl.TaskResult.Failed, 'managedIdentityScopeResource should have passed but failed');
        }
    }

    // Feature disabled -> preserve the previous Managed Identity resource even if MSAL supplies
    // a different requested scope to the token provider.
    public static async managedIdentityLegacyResourceWhenFeatureDisabled() {
        try {
            nock("http://169.254.169.254", {
                reqheaders: {
                    "Metadata": true
                }
            })
                .get("/metadata/identity/oauth2/token")
                .query({
                    "api-version": "2018-02-01",
                    "resource": "https://management.azure.com/"
                })
                .reply(200, {
                    access_token: "DUMMY_ARM_TOKEN_FROM_MSI",
                    expires_in: 3600
                });

            const creds = makeManagedIdentityCreds(false);
            const msalClient = await creds.buildMSAL();
            const result = await msalClient.acquireTokenByClientCredential({
                scopes: ["https://appservice/.default"]
            });
            if (result.accessToken !== "DUMMY_ARM_TOKEN_FROM_MSI") {
                throw new Error(`unexpected Managed Identity token: ${result.accessToken}`);
            }
            console.log('MSI_FEATURE_DISABLED_RESOURCE: https://management.azure.com/');
        } catch (error) {
            console.log(error);
            tl.setResult(tl.TaskResult.Failed, 'managedIdentityLegacyResourceWhenFeatureDisabled should have passed but failed');
        }
    }

    public static async federatedTokenFileCleanup() {
        let tempDirectory: string;
        let cleanupFailurePath: string;
        try {
            process.env[scopeFeatureVariable] = "true";
            const creds: any = makeCreds(true, { appservice: "https://appservice/.default" });
            tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'azure-arm-rest-'));
            const tokenFilePath = path.join(tempDirectory, 'token.jwt');
            fs.writeFileSync(tokenFilePath, 'DUMMY_OIDC_TOKEN');
            creds.deleteFederatedTokenFile(tokenFilePath);
            if (fs.existsSync(tokenFilePath)) {
                throw new Error('federated token file was not deleted');
            }

            cleanupFailurePath = path.join(tempDirectory, 'undeletable-directory');
            fs.mkdirSync(cleanupFailurePath);
            creds.deleteFederatedTokenFile(cleanupFailurePath);
            console.log('FEDERATED_TOKEN_CLEANUP_TEST: completed');
        } catch (error) {
            console.log(error);
            tl.setResult(tl.TaskResult.Failed, 'federatedTokenFileCleanup should have passed but failed');
        } finally {
            if (cleanupFailurePath && fs.existsSync(cleanupFailurePath)) {
                fs.rmdirSync(cleanupFailurePath);
            }
            if (tempDirectory && fs.existsSync(tempDirectory)) {
                fs.rmdirSync(tempDirectory);
            }
        }
    }

    public static async unknownKuduAuthMode() {
        try {
            process.env[scopeFeatureVariable] = "true";
            publishKuduAuthModeTelemetry({
                authMethod: "Bearer",
                source: "test",
                credentials: {
                    getLastScopeTokenTelemetry: () => ({
                        requestedAudience: undefined,
                        outcome: undefined,
                        allowScopeLevelToken: true,
                        scheme: "ServicePrincipal",
                        authorityHost: "login.windows.net"
                    })
                }
            });
            console.log('KUDU_AUTH_UNKNOWN: emitted');
        } catch (error) {
            console.log(error);
            tl.setResult(tl.TaskResult.Failed, 'unknownKuduAuthMode should have passed but failed');
        }
    }

    public static async kuduAuthModeFeatureDisabled() {
        const originalLog = console.log;
        let emittedKuduAuthModeTelemetry = false;
        try {
            process.env[scopeFeatureVariable] = "false";
            console.log = (...args: any[]) => {
                if (args.join(" ").indexOf("feature=KuduAuthMode") >= 0) {
                    emittedKuduAuthModeTelemetry = true;
                }
                originalLog.apply(console, args);
            };
            publishKuduAuthModeTelemetry({
                authMethod: "Basic",
                source: "test"
            });
        } catch (error) {
            originalLog(error);
            tl.setResult(tl.TaskResult.Failed, 'kuduAuthModeFeatureDisabled should have passed but failed');
        } finally {
            console.log = originalLog;
            originalLog('KUDU_AUTH_DISABLED_TELEMETRY: ' + emittedKuduAuthModeTelemetry);
            process.env[scopeFeatureVariable] = "true";
        }
    }

    // Feature enabled and scope mapped, but scoped token acquisition fails -> fails without ARM fallback.
    public static async scopedTokenFailure() {
        try {
            process.env[scopeFeatureVariable] = "true";
            const creds: any = makeCreds(true, { appservice: "https://appservice/.default" });
            creds.buildCredentialByScheme = async () => ({
                credential: {
                    getToken: async () => {
                        const error = new Error("network_error");
                        error.name = "AuthenticationRequiredError";
                        throw error;
                    }
                }
            });
            await creds.acquireTokenForScope("appservice");
            tl.setResult(tl.TaskResult.Failed, 'scopedTokenFailure should have failed');
        } catch (error) {
            console.log('SCOPED_TOKEN_ERROR: ' + error.message);
        }
    }

    private static captureProxyEnvironment(): { [key: string]: string } {
        const values: { [key: string]: string } = {};
        proxyEnvironmentVariables.forEach(variable => {
            values[variable] = process.env[variable];
        });
        return values;
    }

    private static restoreProxyEnvironment(values: { [key: string]: string }): void {
        proxyEnvironmentVariables.forEach(variable => {
            if (values[variable] === undefined) {
                delete process.env[variable];
            } else {
                process.env[variable] = values[variable];
            }
        });
    }
}

async function RUNTESTS() {
    await ScopeTokenTests.scopedTokenSuccess();
    await ScopeTokenTests.authenticatedProxyOptions();
    await ScopeTokenTests.credentialConstructorsReceiveProxyOptions();
    await ScopeTokenTests.proxyDefaultPorts();
    await ScopeTokenTests.bypassedProxyOptions();
    await ScopeTokenTests.noProxyOptions();
    await ScopeTokenTests.featureDisabledDoesNotReadProxy();
    await ScopeTokenTests.scopedTokenSuccessOnLegacyNode();
    await ScopeTokenTests.managedIdentityScopeResource();
    await ScopeTokenTests.managedIdentityLegacyResourceWhenFeatureDisabled();
    await ScopeTokenTests.federatedTokenFileCleanup();
    await ScopeTokenTests.unknownKuduAuthMode();
    await ScopeTokenTests.kuduAuthModeFeatureDisabled();
    await ScopeTokenTests.fallbackWhenFeatureDisabled();
    await ScopeTokenTests.fallbackWhenScopeUnmapped();
    await ScopeTokenTests.scopedTokenFailure();
}

RUNTESTS();
