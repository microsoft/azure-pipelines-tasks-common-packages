import assert = require("assert");
import Module = require("module");

const originalVersion = process.version;
const runtime = process.argv[2] === "native" ? Number(process.versions.node.split(".")[0]) : Number(process.argv[2]);
const feature = process.argv[3];
const originalLoad = (Module as any)._load;
let identityLoads = 0;
let msalClient: string;

async function run() {
    try {
        Object.defineProperty(process, "version", { value: `v${runtime}.0.0`, configurable: true });
        const tl = require("azure-pipelines-task-lib/task");
        if (feature === "undefined") {
            delete process.env.DISTRIBUTEDTASK_TASKS_ALLOWSCOPELEVELTOKEN;
        } else {
            tl.setVariable("DistributedTask.Tasks.AllowScopeLevelToken", feature);
        }
        const enabled = tl.getPipelineFeature("ALLOWSCOPELEVELTOKEN");
        const loadIdentity = runtime >= 16;
        (Module as any)._load = function (request: string) {
            if (request === "@azure/identity") {
                identityLoads++;
                assert(loadIdentity, "SDK imports must match the runtime and feature-flag baseline");
                return {};
            }
            if (request === "msalv1" || request === "msalv3") {
                msalClient = request;
            }
            return originalLoad.apply(this, arguments);
        };

        const { ApplicationTokenCredentials } = require("../azure-arm-common");
        require("nock").disableNetConnect();
        const managedIdentity = process.argv[4] === "msi";
        const appServiceScope = managedIdentity ? "https://appservice/.default" : "https://appservice.azure.cn/.default";
        const armResource = managedIdentity ? "https://management.azure.com/" : "https://management.chinacloudapi.cn";
        const armScope = armResource + "/.default";
        const creds: any = new ApplicationTokenCredentials(
            "MOCK_CONNECTION", managedIdentity ? undefined : "MOCK_CLIENT", "MOCK_TENANT_ID", "MOCK_SECRET",
            armResource, managedIdentity ? "https://login.windows.net/" : "https://login.chinacloudapi.cn/",
            armResource, false,
            process.argv[5], process.argv[6], undefined, undefined, undefined, undefined,
            true, enabled, { appservice: appServiceScope }
        );
        if (process.argv[4] === "msi") {
            const query: any = {
                "api-version": "2018-02-01",
                resource: enabled ? "https://appservice" : armResource
            };
            if (enabled) {
                query.client_id = "MOCK_USER_ASSIGNED_CLIENT";
            }
            require("nock")("http://169.254.169.254", { reqheaders: { Metadata: true } })
                .get("/metadata/identity/oauth2/token")
                .query(query)
                .reply(200, { access_token: "MOCK_MSI_TOKEN", expires_in: 3600 });
            assert.strictEqual(await creds.acquireTokenForScope("appservice"), "MOCK_MSI_TOKEN");
            console.log("RUNTIME_SCOPE_TEST_PASSED");
            return;
        }
        let federatedTokens = 0;
        creds.getFederatedToken = async () => `MOCK_FEDERATED_TOKEN_${++federatedTokens}`;
        let msalCalls = 0;
        let identityCalls = 0;
        let expectedScope = enabled ? appServiceScope : armScope;
        let requestAssertion: string;
        const buildMSAL = creds.buildMSAL.bind(creds);
        creds.buildMSAL = async () => {
            const client = await buildMSAL();
            client.acquireTokenByClientCredential = async (request: any) => {
                msalCalls++;
                assert.deepStrictEqual(request.scopes, [expectedScope]);
                requestAssertion = request.clientAssertion;
                return { accessToken: "MOCK_MSAL_TOKEN", fromCache: false };
            };
            return client;
        };
        creds.buildCredentialByScheme = async () => {
            identityCalls++;
            return {
                credential: {
                    getToken: async (scope: string) => {
                        assert.strictEqual(scope, appServiceScope);
                        return { token: "MOCK_IDENTITY_TOKEN" };
                    }
                }
            };
        };

        if (process.argv[4] === "refresh") {
            expectedScope = armScope;
            await creds.getToken();
            assert.strictEqual(federatedTokens, 1);
            assert.strictEqual(requestAssertion, undefined);
            expectedScope = enabled ? appServiceScope : armScope;
            for (let invocation = 2; invocation <= 3; invocation++) {
                await creds.acquireTokenForScope("appservice");
                assert.strictEqual(federatedTokens, enabled ? invocation : 1);
                assert.strictEqual(requestAssertion, enabled ? `MOCK_FEDERATED_TOKEN_${invocation}` : undefined);
            }
            console.log("RUNTIME_SCOPE_TEST_PASSED");
            return;
        }

        if (process.argv[4] === "failure") {
            creds.getMSALToken = async () => { throw new Error("MOCK_SCOPED_MSAL_ERROR"); };
            creds.getToken = async () => { throw new Error("Unexpected ARM fallback"); };
            await assert.rejects(creds.acquireTokenForScope("appservice"), /MOCK_SCOPED_MSAL_ERROR/);
            const telemetry = creds.getLastScopeTokenTelemetry();
            assert.strictEqual(telemetry.requestedAudience, "None");
            assert.strictEqual(telemetry.outcome, "error");
            console.log("RUNTIME_SCOPE_TEST_PASSED");
            return;
        }

        const useIdentity = enabled && runtime >= 22;
        const token = await creds.acquireTokenForScope("appservice");
        assert.strictEqual(token, useIdentity ? "MOCK_IDENTITY_TOKEN" : "MOCK_MSAL_TOKEN");
        assert.strictEqual(identityLoads, loadIdentity ? 1 : 0);
        assert.strictEqual(msalClient, runtime < 16 ? "msalv1" : "msalv3");
        assert.strictEqual(identityCalls, useIdentity ? 1 : 0);
        assert.strictEqual(msalCalls, useIdentity ? 0 : 1);
        const telemetry = creds.getLastScopeTokenTelemetry();
        assert.strictEqual(telemetry.requestedAudience, enabled ? "AppService" : undefined);
        assert.strictEqual(telemetry.outcome, enabled ? "scoped" : undefined);
        console.log("RUNTIME_SCOPE_TEST_PASSED");
    } finally {
        (Module as any)._load = originalLoad;
        Object.defineProperty(process, "version", { value: originalVersion, configurable: true });
    }
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
