import { WebApi } from "azure-devops-node-api";
import { initOIDCToken } from "../azCliUtility";

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
    public static async initOIDCTokenTestRetryMechanism() {
        try {
            await initOIDCToken(new WebApiMockNull() as WebApi, 'https://dev.azure.com/organization', 'project', 'pipeline', 'job', 'task', 0, 0);
        } catch (error) {
            //
        }
    }

    public static async initOIDCTokenTestAggregateError() {
        try {
            await initOIDCToken(new WebApiMockThrowing() as WebApi, 'https://dev.azure.com/organization', 'project', 'pipeline', 'job', 'task', 3, 0);
        } catch (error) {
            //
        }
    }
}

async function RUNTESTS() {
    await AzureCliUtilityTests.initOIDCTokenTestRetryMechanism();
    await AzureCliUtilityTests.initOIDCTokenTestAggregateError();
}

RUNTESTS();
