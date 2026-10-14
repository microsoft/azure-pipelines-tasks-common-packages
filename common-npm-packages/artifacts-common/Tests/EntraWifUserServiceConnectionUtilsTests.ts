import * as assert from "assert";
import * as mocker from "azure-pipelines-task-lib/lib-mocker";
import { ProtocolType } from "../protocols";

export function entraWifUserServiceConnectionUtilsTests() {
    let calls: string[];
    let trackOidcCalls: boolean;
    let rejectFeedHost: boolean;
    let resourceTenant: string | undefined;
    let tenantRedirectLocation: string | undefined;
    let headRedirectMode: string | undefined;
    let serverType: string | undefined;
    let systemServiceUrl: string;

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
        trackOidcCalls = false;
        rejectFeedHost = false;
        resourceTenant = "11111111-1111-4111-8111-111111111111";
        tenantRedirectLocation = undefined;
        headRedirectMode = undefined;
        serverType = "Hosted";
        systemServiceUrl = "https://devops.example.test/organization/";
        process.env.SYSTEM_COLLECTIONURI = "https://devops.example.test/organization/";

        mocker.resetCache();
        mocker.registerAllowable("path");
        mocker.registerAllowable("../EntraWifUserServiceConnectionUtils");
        mocker.registerAllowable("./protocols");
        mocker.registerMock("./retryUtils", {
            retryOnException: async (action: () => Promise<unknown>) => action()
        });
        mocker.registerMock("azure-pipelines-task-lib/task", {
            debug: () => {},
            getEndpointUrlRequired: () =>
                systemServiceUrl,
            getEndpointAuthorizationParameterRequired: (_name: string, parameter: string) =>
                parameter === "ServicePrincipalId" ? "client-id" : "service-connection-tenant",
            getVariable: (name: string) => {
                const values = {
                    "System.TeamProjectId": "project-id",
                    "System.HostType": "build",
                    "System.PlanId": "plan-id",
                    "System.JobId": "job-id",
                    "System.ServerType": serverType
                };
                return values[name];
            },
            loc: (key: string) => key,
            setResourcePath: () => {},
            setSecret: () => {}
        });
        mocker.registerMock("./feedUrlUtils", {
            verifyAzureArtifactsFeedUrl: async (
                feedUrl: string | URL,
                protocolType: ProtocolType
            ) => {
                const url = typeof feedUrl === "string" ? new URL(feedUrl) : feedUrl;
                calls.push(`verify-feed:${protocolType}:${url.href}`);
                if (url.protocol !== "https:") {
                    throw new Error("Error_UrlHttpsRequired");
                }
                if (rejectFeedHost && url.hostname === "attacker.example") {
                    throw new Error("Error_FeedUrlUntrustedHost");
                }
                return url;
            }
        });
        mocker.registerMock("./webapi", {
            getSystemAccessToken: () => {
                if (trackOidcCalls) {
                    calls.push("system-token");
                }
                return "system-token";
            },
            requireHttpsUrl: (value: string) => {
                const url = new URL(value);
                if (url.protocol !== "https:") {
                    throw new Error("Error_UrlHttpsRequired");
                }
                return url;
            }
        });
        mocker.registerMock("azure-devops-node-api", {
            getBearerHandler: (token: string) => {
                if (trackOidcCalls) {
                    calls.push(`bearer:${token}`);
                }
                return {};
            },
            WebApi: class {
                public async getTaskApi() {
                    if (trackOidcCalls) {
                        calls.push("task-api");
                    }
                    return {
                        createOidcToken: async (
                            _claims: unknown,
                            projectId: string,
                            hub: string,
                            planId: string,
                            jobId: string,
                            serviceConnectionName: string
                        ) => {
                            if (trackOidcCalls) {
                                calls.push(
                                    `create-oidc:${projectId}:${hub}:${planId}:${jobId}:${serviceConnectionName}`
                                );
                            }
                            return { oidcToken: "task-api-token" };
                        }
                    };
                }
            }
        });
        mocker.registerMock("node-fetch", {
            __esModule: true,
            default: async (
                url: string,
                options?: { method?: string; redirect?: string }
            ) => {
                calls.push(`fetch:${url}`);
                if (options?.method === "HEAD") {
                    headRedirectMode = options.redirect;
                    return {
                        status: tenantRedirectLocation &&
                            url === "https://pkgs.internal.test/organization/feed"
                            ? 302
                            : 200,
                        headers: {
                            get: (name: string) => {
                                if (name.toLowerCase() === "location") {
                                    return tenantRedirectLocation;
                                }
                                if (name.toLowerCase() === "x-vss-resourcetenant") {
                                    return resourceTenant;
                                }
                                return undefined;
                            }
                        }
                    };
                }
                return {
                    json: async () => ({
                        access_token: url.includes("attacker-controlled-tenant")
                            ? undefined
                            : "access-token"
                    })
                };
            }
        });
    });

    afterEach(() => {
        delete process.env.SYSTEM_COLLECTIONURI;
        mocker.deregisterAll();
    });

    it("rejects workload identity federation outside Azure DevOps Services", async () => {
        serverType = "OnPremises";
        const utils = require("../EntraWifUserServiceConnectionUtils");

        await assert.rejects(
            () => utils.getFederatedWorkloadIdentityCredentials(
                "service-connection"
            ),
            /Error_WifAuthenticationHostedOnly/
        );

        assert.deepStrictEqual(calls, []);
    });

    it("creates the OIDC assertion through the authenticated Task API", async () => {
        trackOidcCalls = true;
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

    it("rejects an HTTP system endpoint before obtaining the system token", async () => {
        systemServiceUrl = "http://devops.example.test/organization/";
        trackOidcCalls = true;
        const utils = require("../EntraWifUserServiceConnectionUtils");

        await assert.rejects(
            () => utils.getFederatedWorkloadIdentityCredentials(
                "service-connection"
            ),
            /Error_UrlHttpsRequired/
        );

        assert.deepStrictEqual(calls, []);
    });

    it("accepts legacy string feed URLs and defaults to NuGet", async () => {
        const utils = require("../EntraWifUserServiceConnectionUtils");

        const tenantId = await utils.getFeedTenantId(
            "https://pkgs.internal.test/organization/feed"
        );

        assert.strictEqual(
            tenantId,
            "11111111-1111-4111-8111-111111111111"
        );
        assert.deepStrictEqual(calls, [
            "verify-feed:0:https://pkgs.internal.test/organization/feed",
            "fetch:https://pkgs.internal.test/organization/feed"
        ]);
    });

    it("rejects an untrusted legacy string feed URL before tenant discovery", async () => {
        rejectFeedHost = true;
        const utils = require("../EntraWifUserServiceConnectionUtils");

        await assert.rejects(
            () => utils.getFeedTenantId("https://attacker.example/feed"),
            /Error_FeedUrlUntrustedHost/
        );
        assert.deepStrictEqual(calls, [
            "verify-feed:0:https://attacker.example/feed"
        ]);
    });

    it("binds credentials using the resource tenant returned by the feed", async () => {
        const utils = require("../EntraWifUserServiceConnectionUtils");

        const credentials =
            await utils.getFederatedWorkloadIdentityCredentialsForFeed(
                "service-connection",
                new URL("HTTPS://PKGS.INTERNAL.TEST/organization/feed"),
                ProtocolType.PyPi
            );

        assert.strictEqual(credentials.accessToken, "access-token");
        assert.strictEqual(
            credentials.feedUrl.href,
            "https://pkgs.internal.test/organization/feed"
        );
        assert.deepStrictEqual(calls, [
            "verify-feed:3:https://pkgs.internal.test/organization/feed",
            "fetch:https://pkgs.internal.test/organization/feed",
            "fetch:https://login.windows.net/11111111-1111-4111-8111-111111111111/oauth2/v2.0/token"
        ]);
        assert.strictEqual(headRedirectMode, "manual");
    });

    it("supports a cross-organization feed on a trusted host", async () => {
        const utils = require("../EntraWifUserServiceConnectionUtils");

        const credentials =
            await utils.getFederatedWorkloadIdentityCredentialsForFeed(
                "service-connection",
                new URL("https://pkgs.internal.test/other-organization/feed"),
                ProtocolType.NuGet
            );

        assert.strictEqual(credentials.accessToken, "access-token");
        assert.deepStrictEqual(calls, [
            "verify-feed:0:https://pkgs.internal.test/other-organization/feed",
            "fetch:https://pkgs.internal.test/other-organization/feed",
            "fetch:https://login.windows.net/11111111-1111-4111-8111-111111111111/oauth2/v2.0/token"
        ]);
    });

    it("discovers the PyPI tenant from the same feed's simple endpoint", async () => {
        const utils = require("../EntraWifUserServiceConnectionUtils");

        const credentials =
            await utils.getFederatedWorkloadIdentityCredentialsForFeed(
                "service-connection",
                new URL("https://pkgs.internal.test/org/_packaging/feed/pypi/upload/"),
                ProtocolType.PyPi
            );

        assert.strictEqual(
            credentials.feedUrl.href,
            "https://pkgs.internal.test/org/_packaging/feed/pypi/upload/"
        );
        assert.deepStrictEqual(calls, [
            "verify-feed:3:https://pkgs.internal.test/org/_packaging/feed/pypi/upload/",
            "fetch:https://pkgs.internal.test/org/_packaging/feed/pypi/simple/",
            "fetch:https://login.windows.net/11111111-1111-4111-8111-111111111111/oauth2/v2.0/token"
        ]);
        assert.strictEqual(headRedirectMode, "manual");
    });

    it("discovers the Cargo tenant from the registry config endpoint", async () => {
        const utils = require("../EntraWifUserServiceConnectionUtils");

        const credentials =
            await utils.getFederatedWorkloadIdentityCredentialsForFeed(
                "service-connection",
                new URL("https://pkgs.internal.test/org/_packaging/feed/Cargo/index/"),
                ProtocolType.Cargo
            );

        assert.strictEqual(
            credentials.feedUrl.href,
            "https://pkgs.internal.test/org/_packaging/feed/Cargo/index/"
        );
        assert.deepStrictEqual(calls, [
            "verify-feed:4:https://pkgs.internal.test/org/_packaging/feed/Cargo/index/",
            "fetch:https://pkgs.internal.test/org/_packaging/feed/Cargo/index/config.json",
            "fetch:https://login.windows.net/11111111-1111-4111-8111-111111111111/oauth2/v2.0/token"
        ]);
        assert.strictEqual(headRedirectMode, "manual");
    });

    it("uses the tenant header from the verified feed redirect response without following it", async () => {
        tenantRedirectLocation = "/canonical-feed";
        const utils = require("../EntraWifUserServiceConnectionUtils");

        const credentials =
            await utils.getFederatedWorkloadIdentityCredentialsForFeed(
                "service-connection",
                new URL("https://pkgs.internal.test/organization/feed"),
                ProtocolType.NuGet
            );

        assert.strictEqual(credentials.accessToken, "access-token");
        assert.deepStrictEqual(calls, [
            "verify-feed:0:https://pkgs.internal.test/organization/feed",
            "fetch:https://pkgs.internal.test/organization/feed",
            "fetch:https://login.windows.net/11111111-1111-4111-8111-111111111111/oauth2/v2.0/token"
        ]);
    });

    it("does not follow an untrusted tenant-discovery redirect location", async () => {
        rejectFeedHost = true;
        tenantRedirectLocation = "https://attacker.example/tenant";
        const utils = require("../EntraWifUserServiceConnectionUtils");

        const credentials =
            await utils.getFederatedWorkloadIdentityCredentialsForFeed(
                "service-connection",
                new URL("https://pkgs.internal.test/organization/feed"),
                ProtocolType.NuGet
            );

        assert.strictEqual(credentials.accessToken, "access-token");
        assert.deepStrictEqual(calls, [
            "verify-feed:0:https://pkgs.internal.test/organization/feed",
            "fetch:https://pkgs.internal.test/organization/feed",
            "fetch:https://login.windows.net/11111111-1111-4111-8111-111111111111/oauth2/v2.0/token"
        ]);
    });

    it("lets the WIF exchange reject a malformed resource tenant", async () => {
        resourceTenant = "attacker-controlled-tenant";
        const utils = require("../EntraWifUserServiceConnectionUtils");

        await assert.rejects(
            () => utils.getFederatedWorkloadIdentityCredentialsForFeed(
                "service-connection",
                new URL("https://pkgs.internal.test/organization/feed"),
                ProtocolType.NuGet
            ),
            /Error_FederatedTokenAquisitionFailed/
        );

        assert.deepStrictEqual(calls, [
            "verify-feed:0:https://pkgs.internal.test/organization/feed",
            "fetch:https://pkgs.internal.test/organization/feed",
            "fetch:https://login.windows.net/attacker-controlled-tenant/oauth2/v2.0/token"
        ]);
    });

    it("rejects an untrusted host before probing the tenant or acquiring credentials", async () => {
        rejectFeedHost = true;
        const utils = require("../EntraWifUserServiceConnectionUtils");

        await assert.rejects(
            () => utils.getFederatedWorkloadIdentityCredentialsForFeed(
                "service-connection",
                new URL("https://attacker.example/feed"),
                ProtocolType.NuGet
            ),
            /Error_FeedUrlUntrustedHost/
        );

        assert.deepStrictEqual(calls, [
            "verify-feed:0:https://attacker.example/feed"
        ]);
    });

    it("rejects a trusted host that does not return a resource tenant", async () => {
        resourceTenant = undefined;
        const utils = require("../EntraWifUserServiceConnectionUtils");

        await assert.rejects(
            () => utils.getFederatedWorkloadIdentityCredentialsForFeed(
                "service-connection",
                new URL("https://pkgs.internal.test/organization/feed"),
                ProtocolType.NuGet
            ),
            /Error_FeedTenantUnavailable/
        );

        assert.deepStrictEqual(calls, [
            "verify-feed:0:https://pkgs.internal.test/organization/feed",
            "fetch:https://pkgs.internal.test/organization/feed"
        ]);
    });

    it("rejects an invalid feed destination before acquiring credentials", async () => {
        const utils = require("../EntraWifUserServiceConnectionUtils");

        await assert.rejects(
            () => utils.getFederatedWorkloadIdentityCredentialsForFeed(
                "service-connection",
                new URL("http://attacker.example/feed"),
                ProtocolType.NuGet
            ),
            /Error_UrlHttpsRequired/
        );

        assert.deepStrictEqual(calls, [
            "verify-feed:0:http://attacker.example/feed"
        ]);
    });
}
