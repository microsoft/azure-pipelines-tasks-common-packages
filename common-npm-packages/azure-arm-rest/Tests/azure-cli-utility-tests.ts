import assert = require("assert");
import { WebApi } from "azure-devops-node-api";
import * as tl from "azure-pipelines-task-lib/task";
import { initOIDCToken2, loginAzureRM, setAzureCloudBasedOnServiceEndpoint } from "../azCliUtility";

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
    await AzureCliUtilityTests.initOIDCTokenTestRetryMechanism();
    await AzureCliUtilityTests.initOIDCTokenTestAggregateError();
}

RUNTESTS();
