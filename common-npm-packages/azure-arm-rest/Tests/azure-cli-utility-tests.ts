import assert = require("assert");
import { WebApi } from "azure-devops-node-api";
import * as tl from "azure-pipelines-task-lib/task";
import { AzureRMLoginCredentials, cleanupAzureRMLoginCredentials, initOIDCToken2, loginAzureRM, setAzureCloudBasedOnServiceEndpoint } from "../azCliUtility";

class TaskApiNull {
    async createOidcToken() {
        // Simulate a failure to fetch OIDC token
        return null;
    }
}

class WebApiMockNull {
    getTaskApi() {
        return new Promise((resolve) => {
            resolve(new TaskApiNull());
        });
    }
}

// Polyfill AggregateError if not available in the environment
const AggregateErrorGlobal: any = (typeof (globalThis as any).AggregateError !== "undefined")
    ? (globalThis as any).AggregateError
    : class AggregateError extends Error {
        constructor(errors: Error[]) {
            super("AggregateError: " + errors.map(e => e.message).join(", "));
            this.name = "AggregateError";
            this.errors = errors;
        }

        errors: Error[];
    };

class TaskApiThrowing {
    async createOidcToken() {
        throw new AggregateErrorGlobal([new Error('1'), new Error('2'), new Error('3')]);
    }
}

class WebApiMockThrowing {
    getTaskApi() {
        return new Promise((resolve) => {
            resolve(new TaskApiThrowing());
        });
    }
}

export class AzureCliUtilityTests {
    public static async resolvedAzureCliPathTest() {
        const azureCliPath = "C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd";
        const invocations: string[] = [];
        const originalExecSync = tl.execSync;
        const originalGetEndpointAuthorizationScheme = tl.getEndpointAuthorizationScheme;
        const originalGetEndpointAuthorizationParameter = tl.getEndpointAuthorizationParameter;
        const originalGetEndpointDataParameter = tl.getEndpointDataParameter;
        const originalSetSecret = tl.setSecret;

        try {
            (tl as any).execSync = (tool: string, args: string) => {
                invocations.push(`${tool} ${args}`);
                return {
                    code: 0,
                    stdout: args === "--version" ? "azure-cli 2.66.0" : "",
                    stderr: ""
                };
            };
            (tl as any).getEndpointAuthorizationScheme = () => "serviceprincipal";
            (tl as any).getEndpointAuthorizationParameter = (_connectedService: string, parameterName: string) => {
                const parameters = {
                    authenticationType: "key",
                    serviceprincipalid: "client-id",
                    tenantid: "tenant-id",
                    serviceprincipalkey: "client-secret"
                };
                return parameters[parameterName];
            };
            (tl as any).getEndpointDataParameter = (_connectedService: string, parameterName: string) => {
                const parameters = {
                    environment: "AzureCloud",
                    SubscriptionID: "subscription-id"
                };
                return parameters[parameterName];
            };
            (tl as any).setSecret = () => {};

            setAzureCloudBasedOnServiceEndpoint("connected-service", azureCliPath);
            await loginAzureRM("connected-service", azureCliPath);

            assert.strictEqual(invocations.length, 4);
            assert(invocations.every(invocation => invocation.startsWith(`${azureCliPath} `)));
            assert(invocations.some(invocation => invocation.endsWith("cloud set -n AzureCloud")));
            assert(invocations.some(invocation => invocation.endsWith("--version")));
            assert(invocations.some(invocation => invocation.indexOf(" login --service-principal ") >= 0));
            assert(invocations.some(invocation => invocation.endsWith('account set --subscription "subscription-id"')));
            console.log("ALL_AZURE_CLI_INVOCATIONS_USE_RESOLVED_PATH");
        }
        finally {
            (tl as any).execSync = originalExecSync;
            (tl as any).getEndpointAuthorizationScheme = originalGetEndpointAuthorizationScheme;
            (tl as any).getEndpointAuthorizationParameter = originalGetEndpointAuthorizationParameter;
            (tl as any).getEndpointDataParameter = originalGetEndpointDataParameter;
            (tl as any).setSecret = originalSetSecret;
        }
    }

    public static async certificateLoginTest(featureEnabled: boolean, scenario: string, options: { agentTemp?: string, loginExitCode?: number } = {}) {
        const fs = require("fs");
        const os = require("os");
        const path = require("path");
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "azarmrest-cert-test-"));
        const agentTemp = options.hasOwnProperty("agentTemp") ? options.agentTemp : tempRoot;
        const invocations: string[] = [];
        const certificateContent = "-----BEGIN PRIVATE KEY-----test-----END PRIVATE KEY-----";
        const originals = {
            execSync: tl.execSync,
            getEndpointAuthorizationScheme: tl.getEndpointAuthorizationScheme,
            getEndpointAuthorizationParameter: tl.getEndpointAuthorizationParameter,
            getEndpointDataParameter: tl.getEndpointDataParameter,
            getVariable: tl.getVariable,
            getPipelineFeature: tl.getPipelineFeature,
            setSecret: tl.setSecret
        };
        let certificatePathSeenByAz: string = null;
        let certificateContentSeenByAz: string = null;

        try {
            (tl as any).execSync = (tool: string, args: string) => {
                invocations.push(args);
                const match = args.match(/--certificate="([^"]+)"/);
                if (match) {
                    certificatePathSeenByAz = match[1];
                    certificateContentSeenByAz = fs.readFileSync(certificatePathSeenByAz, "utf8");
                }
                const failLogin = args.indexOf("login ") === 0 && options.loginExitCode;
                return { code: failLogin ? options.loginExitCode : 0, stdout: args === "--version" ? "azure-cli 2.66.0" : "", stderr: "" };
            };
            (tl as any).getEndpointAuthorizationScheme = () => "serviceprincipal";
            (tl as any).getEndpointAuthorizationParameter = (_connectedService: string, parameterName: string) => ({
                authenticationType: "spnCertificate",
                serviceprincipalid: "client-id",
                tenantid: "tenant-id",
                servicePrincipalCertificate: certificateContent
            })[parameterName];
            (tl as any).getEndpointDataParameter = () => undefined;
            (tl as any).getVariable = (name: string) => ({
                "Agent.TempDirectory": agentTemp,
                "system.DefaultWorkingDirectory": tempRoot
            })[name];
            (tl as any).getPipelineFeature = (name: string) => name === "AzureArmRestCredentialFileIsolationEnabled" ? featureEnabled : false;
            (tl as any).setSecret = () => {};

            let credentials: AzureRMLoginCredentials;
            let loginError: any;
            try {
                credentials = await loginAzureRM("connected-service");
            } catch (error) {
                loginError = error;
            }

            if (!featureEnabled) {
                const legacyPath = path.join(tempRoot, "spnCert.pem");
                assert.strictEqual(loginError, undefined);
                assert.strictEqual(certificatePathSeenByAz, legacyPath);
                assert.strictEqual(credentials.certificatePath, legacyPath);
                assert.strictEqual(credentials.directoryPath, undefined);
                cleanupAzureRMLoginCredentials(credentials);
                assert(fs.existsSync(legacyPath), "legacy certificate cleanup must stay with the caller");
            }
            else if (!agentTemp) {
                assert(loginError, "login must fail when Agent.TempDirectory is not set");
                assert(!invocations.some(args => args.indexOf("login ") === 0), "az login must not run");
                assert(!fs.existsSync(path.join(tempRoot, "spnCert.pem")));
            }
            else if (options.loginExitCode) {
                assert(loginError, "login failure must be rethrown");
                assert(certificatePathSeenByAz);
                assert(!fs.existsSync(path.dirname(certificatePathSeenByAz)), "credential directory must be removed after login failure");
            }
            else {
                assert.strictEqual(loginError, undefined);
                assert.strictEqual(certificatePathSeenByAz, credentials.certificatePath);
                assert.strictEqual(certificateContentSeenByAz, certificateContent);
                assert.strictEqual(path.dirname(credentials.certificatePath), credentials.directoryPath);
                assert.strictEqual(path.dirname(credentials.directoryPath), agentTemp);
                assert(path.basename(credentials.directoryPath).indexOf(".azarmrest-credentials-") === 0);
                assert(!fs.existsSync(path.join(agentTemp, "spnCert.pem")), "fixed certificate path must not be used");
                if (process.platform !== "win32") {
                    assert.strictEqual(fs.statSync(credentials.directoryPath).mode & 0o777, 0o700);
                    assert.strictEqual(fs.statSync(credentials.certificatePath).mode & 0o777, 0o600);
                }
                assert(fs.existsSync(credentials.certificatePath), "certificate must remain available for later az commands");
                cleanupAzureRMLoginCredentials(credentials);
                assert(!fs.existsSync(credentials.directoryPath), "credential directory must be removed by cleanup");
                cleanupAzureRMLoginCredentials(credentials);
            }

            console.log(`CERTIFICATE_LOGIN_${scenario}_PASSED`);
        }
        catch (error) {
            console.log(`CERTIFICATE_LOGIN_${scenario}_FAILED: ${error && error.stack || error}`);
        }
        finally {
            Object.keys(originals).forEach(key => (tl as any)[key] = originals[key]);
            fs.rmSync ? fs.rmSync(tempRoot, { recursive: true, force: true }) : tl.rmRF(tempRoot);
        }
    }

    public static async initOIDCTokenTestRetryMechanism() {
        try {
            await initOIDCToken2(new WebApiMockNull() as WebApi, 'https://dev.azure.com/organization', 'project', 'pipeline', 'job', 'task', 0, 0);
        } catch (error) {
            //
        }
    }

    public static async initOIDCTokenTestAggregateError() {
        try {
            await initOIDCToken2(new WebApiMockThrowing() as WebApi, 'https://dev.azure.com/organization', 'project', 'pipeline', 'job', 'task', 3, 0);
        } catch (error) {
            //
        }
    }
}

async function RUNTESTS() {
    await AzureCliUtilityTests.resolvedAzureCliPathTest();
    await AzureCliUtilityTests.certificateLoginTest(false, "LEGACY");
    await AzureCliUtilityTests.certificateLoginTest(true, "ISOLATED");
    await AzureCliUtilityTests.certificateLoginTest(true, "ISOLATED_LOGIN_FAILURE", { loginExitCode: 1 });
    await AzureCliUtilityTests.certificateLoginTest(true, "ISOLATED_NO_AGENT_TEMP", { agentTemp: undefined });
    await AzureCliUtilityTests.initOIDCTokenTestRetryMechanism();
    await AzureCliUtilityTests.initOIDCTokenTestAggregateError();
}

RUNTESTS();
