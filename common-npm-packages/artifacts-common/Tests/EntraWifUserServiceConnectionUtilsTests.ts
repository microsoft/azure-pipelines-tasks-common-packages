import * as assert from "assert";
import * as mocker from "azure-pipelines-task-lib/lib-mocker";

export function entraWifUserServiceConnectionUtilsTests() {
    let calls: string[];
    let useLateBoundToken: boolean;
    let rejectFeedHost: boolean;
    let resourceTenant: string | undefined;

    before(() => {
        mocker.disable();
        mocker.enable({
            useCleanCache: true,
            warnOnUnregistered: true
        } as mocker.MockOptions);
    });

    after(() => {
        mocker.disable();
    });

    beforeEach(() => {
        calls = [];
        useLateBoundToken = false;
        rejectFeedHost = false;
        resourceTenant = "resource-tenant";
        process.env.SYSTEM_COLLECTIONURI = "https://devops.example.test/organization/";

        mocker.resetCache();
        mocker.registerAllowable("path");
        mocker.registerAllowable("../EntraWifUserServiceConnectionUtils");
        mocker.registerAllowable("./protocols");
        mocker.registerAllowable("./retryUtils");
        mocker.registerMock("azure-pipelines-task-lib/task", {
            debug: () => {},
            getEndpointAuthorizationParameter: (_name: string, parameter: string) =>
                parameter === "idToken" && useLateBoundToken ? "late-bound-token" : undefined,
            getEndpointAuthorizationParameterRequired: (_name: string, parameter: string) =>
                parameter === "ServicePrincipalId" ? "client-id" : "service-connection-tenant",
            getPipelineFeature: () => useLateBoundToken,
            getVariable: (name: string) => {
                const values = {
                    "System.TeamProjectId": "project-id",
                    "System.HostType": "build",
                    "System.PlanId": "plan-id",
                    "System.JobId": "job-id"
                };
                return values[name];
            },
            loc: (key: string) => key,
            setResourcePath: () => {},
            setSecret: () => {}
        });
        mocker.registerMock("./feedUrlUtils", {
            verifyAzureArtifactsFeedUrl: async (
                feedUrl: URL,
                protocolType: number
            ) => {
                calls.push(`verify-feed:${protocolType}:${feedUrl.href}`);
                const url = feedUrl;
                if (url.protocol !== "https:") {
                    throw new Error("Error_FeedUrlHttpsRequired");
                }
                if (rejectFeedHost) {
                    throw new Error("Error_FeedUrlUntrustedHost");
                }
                return url;
            }
        });
        mocker.registerMock("./webapi", {
            getSystemServiceUrl: () =>
                new URL("https://devops.example.test/organization/"),
            getSystemAccessToken: () => {
                calls.push("system-token");
                return "system-token";
            }
        });
        mocker.registerMock("azure-devops-node-api", {
            getBearerHandler: (token: string) => {
                calls.push(`bearer:${token}`);
                return {};
            },
            WebApi: class {
                public async getTaskApi() {
                    calls.push("task-api");
                    return {
                        createOidcToken: async (
                            _claims: unknown,
                            projectId: string,
                            hub: string,
                            planId: string,
                            jobId: string,
                            serviceConnectionName: string
                        ) => {
                            calls.push(
                                `create-oidc:${projectId}:${hub}:${planId}:${jobId}:${serviceConnectionName}`
                            );
                            return { oidcToken: "task-api-token" };
                        }
                    };
                }
            }
        });
        mocker.registerMock("node-fetch", {
            __esModule: true,
            default: async (url: string, options?: { method?: string }) => {
                calls.push(`fetch:${url}`);
                if (options?.method === "HEAD") {
                    return {
                        headers: {
                            get: () => resourceTenant
                        }
                    };
                }
                return { json: async () => ({ access_token: "access-token" }) };
            }
        });
    });

    afterEach(() => {
        delete process.env.SYSTEM_COLLECTIONURI;
        mocker.deregisterAll();
    });

    it("prefers a late-bound ID token and does not read System.AccessToken", async () => {
        useLateBoundToken = true;
        const utils = require("../EntraWifUserServiceConnectionUtils");

        const token = await utils.getFederatedWorkloadIdentityCredentials(
            "service-connection"
        );

        assert.strictEqual(token, "access-token");
        assert.deepStrictEqual(calls, [
            "fetch:https://login.windows.net/service-connection-tenant/oauth2/v2.0/token"
        ]);
    });

    it("creates the OIDC assertion through the authenticated Task API", async () => {
        const utils = require("../EntraWifUserServiceConnectionUtils");

        const token = await utils.getFederatedWorkloadIdentityCredentials(
            "service-connection"
        );

        assert.strictEqual(token, "access-token");
        assert.deepStrictEqual(calls, [
            "system-token",
            "bearer:system-token",
            "task-api",
            "create-oidc:project-id:build:plan-id:job-id:service-connection",
            "fetch:https://login.windows.net/service-connection-tenant/oauth2/v2.0/token"
        ]);
    });

    it("binds credentials using the resource tenant returned by the feed", async () => {
        useLateBoundToken = true;
        const utils = require("../EntraWifUserServiceConnectionUtils");

        const credentials =
            await utils.getFederatedWorkloadIdentityCredentialsForFeed(
                "service-connection",
                new URL("HTTPS://PKGS.INTERNAL.TEST/organization/feed"),
                3
            );

        assert.strictEqual(credentials.accessToken, "access-token");
        assert.strictEqual(
            credentials.feedUrl.href,
            "https://pkgs.internal.test/organization/feed"
        );
        assert.deepStrictEqual(calls, [
            "verify-feed:3:https://pkgs.internal.test/organization/feed",
            "fetch:https://pkgs.internal.test/organization/feed",
            "fetch:https://login.windows.net/resource-tenant/oauth2/v2.0/token"
        ]);
    });

    it("supports a cross-organization feed on a trusted host", async () => {
        useLateBoundToken = true;
        const utils = require("../EntraWifUserServiceConnectionUtils");

        const credentials =
            await utils.getFederatedWorkloadIdentityCredentialsForFeed(
                "service-connection",
                new URL("https://pkgs.internal.test/other-organization/feed")
            );

        assert.strictEqual(credentials.accessToken, "access-token");
        assert.deepStrictEqual(calls, [
            "verify-feed:0:https://pkgs.internal.test/other-organization/feed",
            "fetch:https://pkgs.internal.test/other-organization/feed",
            "fetch:https://login.windows.net/resource-tenant/oauth2/v2.0/token"
        ]);
    });

    it("rejects an untrusted host before probing the tenant or acquiring credentials", async () => {
        useLateBoundToken = true;
        rejectFeedHost = true;
        const utils = require("../EntraWifUserServiceConnectionUtils");

        await assert.rejects(
            () => utils.getFederatedWorkloadIdentityCredentialsForFeed(
                "service-connection",
                new URL("https://attacker.example/feed")
            ),
            /Error_FeedUrlUntrustedHost/
        );

        assert.deepStrictEqual(calls, [
            "verify-feed:0:https://attacker.example/feed"
        ]);
    });

    it("rejects a trusted host that does not return a resource tenant", async () => {
        useLateBoundToken = true;
        resourceTenant = undefined;
        const utils = require("../EntraWifUserServiceConnectionUtils");

        await assert.rejects(
            () => utils.getFederatedWorkloadIdentityCredentialsForFeed(
                "service-connection",
                new URL("https://pkgs.internal.test/organization/feed")
            ),
            /Error_FeedTenantUnavailable/
        );

        assert.deepStrictEqual(calls, [
            "verify-feed:0:https://pkgs.internal.test/organization/feed",
            "fetch:https://pkgs.internal.test/organization/feed"
        ]);
    });

    it("rejects an invalid feed destination before acquiring credentials", async () => {
        useLateBoundToken = true;
        const utils = require("../EntraWifUserServiceConnectionUtils");

        await assert.rejects(
            () => utils.getFederatedWorkloadIdentityCredentialsForFeed(
                "service-connection",
                new URL("http://attacker.example/feed")
            ),
            /Error_FeedUrlHttpsRequired/
        );

        assert.deepStrictEqual(calls, [
            "verify-feed:0:http://attacker.example/feed"
        ]);
    });
}
