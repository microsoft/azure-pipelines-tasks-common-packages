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

    // disableFlagValue: value of DistributedTask.Tasks.DisableAzureArmRestCredentialFileIsolation (undefined = not set).
    public static async certificateLoginTest(disableFlagValue: boolean | undefined, scenario: string, options: { agentTemp?: string, loginExitCode?: number, exitCleanup?: boolean } = {}) {
        const isolationEnabled = disableFlagValue !== true;
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
        const telemetry: any[] = [];
        const originalConsoleLog = console.log;

        try {
            console.log = (...args: any[]) => {
                const message = String(args[0]);
                const marker = "feature=AzureRMLoginCertificateCredentials]";
                if (message.indexOf(marker) >= 0) {
                    telemetry.push(JSON.parse(message.substring(message.indexOf(marker) + marker.length)));
                }
                originalConsoleLog.apply(console, args);
            };
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
            (tl as any).getPipelineFeature = (name: string) => name === "DisableAzureArmRestCredentialFileIsolation" ? disableFlagValue === true : false;
            (tl as any).setSecret = () => {};

            let credentials: AzureRMLoginCredentials;
            let loginError: any;
            try {
                credentials = await loginAzureRM("connected-service");
            } catch (error) {
                loginError = error;
            }

            if (!isolationEnabled) {
                const legacyPath = path.join(tempRoot, "spnCert.pem");
                assert.strictEqual(loginError, undefined);
                assert.strictEqual(certificatePathSeenByAz, legacyPath);
                assert.strictEqual(credentials.certificatePath, legacyPath);
                assert.strictEqual(credentials.directoryPath, undefined);
                assert(fs.existsSync(legacyPath), "legacy certificate must remain available for later az commands");
                cleanupAzureRMLoginCredentials(credentials);
                assert(!fs.existsSync(legacyPath), "legacy certificate must be removed by cleanup");
                cleanupAzureRMLoginCredentials(credentials);
                assert.deepStrictEqual(telemetry, [
                    { isolation: "disabled", login: "succeeded" },
                    { isolation: "disabled", cleanup: "deleted", trigger: "explicit" },
                    { isolation: "disabled", cleanup: "notfound", trigger: "explicit" }
                ]);
            }
            else if (!agentTemp) {
                assert(loginError, "login must fail when Agent.TempDirectory is not set");
                assert(!invocations.some(args => args.indexOf("login ") === 0), "az login must not run");
                assert(!fs.existsSync(path.join(tempRoot, "spnCert.pem")));
                assert.deepStrictEqual(telemetry, [{ isolation: "enabled", login: "failed" }]);
            }
            else if (options.loginExitCode) {
                assert(loginError, "login failure must be rethrown");
                assert(certificatePathSeenByAz);
                assert(!fs.existsSync(path.dirname(certificatePathSeenByAz)), "credential directory must be removed after login failure");
                assert.deepStrictEqual(telemetry, [{ isolation: "enabled", login: "failed" }, { cleanup: "deleted", trigger: "explicit" }]);
            }
            else if (options.exitCleanup) {
                assert.strictEqual(loginError, undefined);
                const secondCredentials = await loginAzureRM("connected-service");
                const exitHandlers = process.listeners("exit").filter((listener: Function) => listener.name === "cleanupAzureRMLoginCredentialsOnExit");
                assert.strictEqual(exitHandlers.length, 1, "exit cleanup must be registered once");
                assert(fs.existsSync(credentials.directoryPath) && fs.existsSync(secondCredentials.directoryPath));
                cleanupAzureRMLoginCredentials(secondCredentials);
                telemetry.length = 0;
                (exitHandlers[0] as Function)();
                assert(!fs.existsSync(credentials.directoryPath), "exit cleanup must remove a leftover credential directory");
                (exitHandlers[0] as Function)();
                cleanupAzureRMLoginCredentials(credentials);
                assert.deepStrictEqual(telemetry, [{ cleanup: "deleted", trigger: "exit" }, { cleanup: "notfound", trigger: "explicit" }]);
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
                assert.deepStrictEqual(telemetry, [
                    { isolation: "enabled", login: "succeeded" },
                    { cleanup: "deleted", trigger: "explicit" },
                    { cleanup: "notfound", trigger: "explicit" }
                ]);
            }

            console.log(`CERTIFICATE_LOGIN_${scenario}_PASSED`);
        }
        catch (error) {
            console.log(`CERTIFICATE_LOGIN_${scenario}_FAILED: ${error && error.stack || error}`);
        }
        finally {
            console.log = originalConsoleLog;
            Object.keys(originals).forEach(key => (tl as any)[key] = originals[key]);
            fs.rmSync ? fs.rmSync(tempRoot, { recursive: true, force: true }) : tl.rmRF(tempRoot);
        }
    }

    public static cleanupRejectsUnsafeDirectoryTest() {
        const fs = require("fs");
        const os = require("os");
        const path = require("path");
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "azarmrest-cleanup-test-"));
        const agentTemp = path.join(tempRoot, "agent-temp");
        const outside = path.join(tempRoot, "outside");
        const victim = path.join(outside, "victim");
        const originalGetVariable = tl.getVariable;

        try {
            fs.mkdirSync(agentTemp);
            fs.mkdirSync(victim, { recursive: true });
            fs.writeFileSync(path.join(victim, "spnCert.pem"), "keep");
            (tl as any).getVariable = (name: string) => name === "Agent.TempDirectory" ? agentTemp : undefined;

            const linkPath = path.join(agentTemp, ".azarmrest-credentials-link");
            fs.symlinkSync(victim, linkPath, "junction");
            cleanupAzureRMLoginCredentials({ directoryPath: linkPath });
            assert(fs.existsSync(path.join(victim, "spnCert.pem")), "cleanup must not follow a directory link");

            const outsideCredentialDirectory = path.join(outside, ".azarmrest-credentials-x");
            fs.mkdirSync(outsideCredentialDirectory);
            fs.writeFileSync(path.join(outsideCredentialDirectory, "spnCert.pem"), "keep");
            cleanupAzureRMLoginCredentials({ directoryPath: outsideCredentialDirectory });
            assert(fs.existsSync(path.join(outsideCredentialDirectory, "spnCert.pem")), "cleanup must stay inside Agent.TempDirectory");

            const unexpectedName = path.join(agentTemp, "not-credentials");
            fs.mkdirSync(unexpectedName);
            cleanupAzureRMLoginCredentials({ directoryPath: unexpectedName });
            assert(fs.existsSync(unexpectedName), "cleanup must only remove credential directories");

            const legacyLinkPath = path.join(agentTemp, "spnCert.pem");
            fs.symlinkSync(victim, legacyLinkPath, "junction");
            cleanupAzureRMLoginCredentials({ certificatePath: legacyLinkPath });
            assert(fs.existsSync(path.join(victim, "spnCert.pem")), "legacy cleanup must not follow a link");
            assert(fs.lstatSync(legacyLinkPath).isSymbolicLink(), "legacy cleanup must only remove a regular file");

            const unexpectedLegacyPath = path.join(outside, "spnCert.pem");
            fs.writeFileSync(unexpectedLegacyPath, "keep");
            cleanupAzureRMLoginCredentials({ certificatePath: unexpectedLegacyPath });
            assert(fs.existsSync(unexpectedLegacyPath), "legacy cleanup must only remove the expected certificate path");

            console.log("CLEANUP_REJECTS_UNSAFE_DIRECTORY_PASSED");
        }
        catch (error) {
            console.log(`CLEANUP_REJECTS_UNSAFE_DIRECTORY_FAILED: ${error && error.stack || error}`);
        }
        finally {
            (tl as any).getVariable = originalGetVariable;
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
    await AzureCliUtilityTests.certificateLoginTest(true, "LEGACY");
    await AzureCliUtilityTests.certificateLoginTest(undefined, "ISOLATED");
    await AzureCliUtilityTests.certificateLoginTest(false, "ISOLATED_DISABLE_FLAG_OFF");
    await AzureCliUtilityTests.certificateLoginTest(undefined, "ISOLATED_LOGIN_FAILURE", { loginExitCode: 1 });
    await AzureCliUtilityTests.certificateLoginTest(undefined, "ISOLATED_NO_AGENT_TEMP", { agentTemp: undefined });
    await AzureCliUtilityTests.certificateLoginTest(undefined, "ISOLATED_EXIT_CLEANUP", { exitCleanup: true });
    AzureCliUtilityTests.cleanupRejectsUnsafeDirectoryTest();
    await AzureCliUtilityTests.initOIDCTokenTestRetryMechanism();
    await AzureCliUtilityTests.initOIDCTokenTestAggregateError();
}

RUNTESTS();
