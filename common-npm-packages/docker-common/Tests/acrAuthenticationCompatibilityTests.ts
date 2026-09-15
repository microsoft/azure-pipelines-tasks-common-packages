import os = require("os");

// azure-arm-rest reads the agent directories during module initialization.
process.env["SYSTEM_DEFAULTWORKINGDIRECTORY"] = process.env["SYSTEM_DEFAULTWORKINGDIRECTORY"] || os.tmpdir();
process.env["AGENT_TEMPDIRECTORY"] = process.env["AGENT_TEMPDIRECTORY"] || os.tmpdir();

import assert = require("assert");
import Q = require("q");
import * as tl from "azure-pipelines-task-lib/task";
import { ApplicationTokenCredentials } from "azure-pipelines-tasks-azure-arm-rest/azure-arm-common";
import { AzureRMEndpoint } from "azure-pipelines-tasks-azure-arm-rest/azure-arm-endpoint";
import { AzureEndpoint } from "azure-pipelines-tasks-azure-arm-rest/azureModels";
import * as webClient from "azure-pipelines-tasks-azure-arm-rest/webClient";
import ACRAuthenticationTokenProvider from "../registryauthenticationprovider/acrauthenticationtokenprovider";
import { getDockerRegistryEndpointAuthenticationToken } from "../registryauthenticationprovider/registryauthenticationtoken";
import { sanitizeUrl } from "../registryauthenticationprovider/registryhostvalidation";

export function runAcrAuthenticationCompatibilityTests(): void {
    const featureVariable = "DistributedTask.Tasks.AcrRegistryHostValidation";
    const featureEnvironmentKey = "DISTRIBUTEDTASK_TASKS_ACRREGISTRYHOSTVALIDATION";
    const endpointId = "test-endpoint";
    const originalTaskMethods = {
        getEndpointAuthorizationScheme: tl.getEndpointAuthorizationScheme,
        getEndpointAuthorizationParameter: tl.getEndpointAuthorizationParameter,
        getEndpointDataParameter: tl.getEndpointDataParameter,
        warning: tl.warning,
        debug: tl.debug
    };
    const originalGetEndpoint = AzureRMEndpoint.prototype.getEndpoint;
    const originalGetMsiToken = ApplicationTokenCredentials.getMSIAuthorizationToken;
    const originalSendRequest = webClient.sendRequest;
    let previousFeature: string;
    let scheme: string;
    let loginServer: string;
    let events: string[];
    let requests: webClient.WebRequest[];
    let warnings: string[];
    let credentialReads: number;
    let schemeInParameter: boolean;

    beforeEach(() => {
        previousFeature = process.env[featureEnvironmentKey];
        scheme = "ServicePrincipal";
        loginServer = "contoso.azurecr.io";
        events = [];
        requests = [];
        warnings = [];
        credentialReads = 0;
        schemeInParameter = false;

        const getScheme: typeof tl.getEndpointAuthorizationScheme = (id) => {
            if (id !== endpointId || schemeInParameter) {
                throw new Error("No authorization scheme in fixture");
            }
            return scheme;
        };
        const getParameter: typeof tl.getEndpointAuthorizationParameter = (id, key) => {
            if (id !== endpointId) {
                throw new Error("No endpoint in fixture");
            }
            if (key === "serviceprincipalid" || key === "serviceprincipalkey") {
                credentialReads++;
            }
            const parameters: { [key: string]: string } = {
                scheme,
                loginserver: loginServer,
                serviceprincipalid: "fixture-client",
                serviceprincipalkey: "fixture-key",
                tenantid: "fixture-tenant"
            };
            return parameters[key.toLowerCase()];
        };
        const getData: typeof tl.getEndpointDataParameter = (id, key) => {
            assert.strictEqual(id, endpointId);
            assert.strictEqual(key.toLowerCase(), "registrytype");
            return "ACR";
        };
        Object.assign(tl, {
            getEndpointAuthorizationScheme: getScheme,
            getEndpointAuthorizationParameter: getParameter,
            getEndpointDataParameter: getData,
            warning: (message: string) => { warnings.push(message); },
            debug: () => {}
        });

        AzureRMEndpoint.prototype.getEndpoint = async (): Promise<AzureEndpoint> => {
            events.push("endpoint");
            const credentials = new ApplicationTokenCredentials(
                endpointId, "fixture-client", "fixture-tenant", "fixture-key",
                "https://management.azure.com/", "https://login.microsoftonline.com/",
                "https://management.azure.com/", false);
            credentials.getToken = async () => {
                events.push("token");
                return "fixture-access-token";
            };
            return {
                subscriptionName: "fixture-subscription",
                tenantID: "fixture-tenant",
                environmentAuthorityUrl: "https://login.microsoftonline.com/",
                url: "https://management.azure.com/",
                environment: "AzureCloud",
                activeDirectoryResourceID: "https://management.azure.com/",
                applicationTokenCredentials: credentials
            };
        };
        ApplicationTokenCredentials.getMSIAuthorizationToken = () => {
            events.push("token");
            return Q.resolve("fixture-access-token");
        };
        const sendRequest: typeof webClient.sendRequest = async (request) => {
            events.push("exchange");
            requests.push(request);
            return {
                statusCode: 200,
                statusMessage: "OK",
                headers: {},
                body: { refresh_token: "fixture-registry-token" }
            };
        };
        Object.assign(webClient, { sendRequest });
    });

    afterEach(() => {
        AzureRMEndpoint.prototype.getEndpoint = originalGetEndpoint;
        ApplicationTokenCredentials.getMSIAuthorizationToken = originalGetMsiToken;
        Object.assign(webClient, { sendRequest: originalSendRequest });
        tl.setVariable(featureVariable, previousFeature || "");
        if (previousFeature === undefined) {
            delete process.env[featureEnvironmentKey];
        }
        Object.assign(tl, originalTaskMethods);
    });

    const supportedSpServers = [
        "contoso.azurecr.io",
        "CONTOSO.AZURECR.IO",
        "contoso.azurecr.io.",
        "https://contoso.azurecr.io",
        "HTTPS://CONTOSO.AZURECR.IO",
        "https://contoso.azurecr.io/",
        "https://CONTOSO.AZURECR.IO./",
        "https://contoso.azurecr.us",
        "https://contoso.azurecr.cn",
        "https://contoso.azurecr.de",
        "https://contoso.azurecr.eaglex.ic.gov",
        "https://contoso.azurecr.microsoft.scloud"
    ];
    const unsupportedSpServers = [
        "other.example.com",
        "contoso.azurecr.io/",
        "http://contoso.azurecr.io",
        "https://contoso.azurecr.io:443",
        "https://contoso.azurecr.io:8443",
        "https://contoso.azurecr.io/v2",
        "https://contoso.azurecr.io//",
        "https://contoso.azurecr.io/./",
        "https://contoso.azurecr.io?",
        "https://contoso.azurecr.io#",
        "https://user@contoso.azurecr.io",
        "https://contoso.azurecr.io\\",
        "https://%63ontoso.azurecr.io",
        "https://other.example.com",
        " https://contoso.azurecr.io",
        "https://contoso.azurecr.io\n",
        "https://contoso.azurecr.io/\n"
    ];
    const absentConfigurations: Array<[string, string]> = [
        [undefined, undefined], [null, null], ["", ""], [undefined, ""], ["", undefined]
    ];
    const partialConfigurations: Array<[string, string]> = [
        [endpointId, undefined], [endpointId, ""], [undefined, "contoso.azurecr.io"],
        ["", "contoso.azurecr.io"], [endpointId, '{"loginServer":""}'], [endpointId, "{}"]
    ];

    for (const enabled of [false, true]) {
        describe(`feature ${enabled ? "on" : "off"}`, () => {
            beforeEach(() => tl.setVariable(featureVariable, String(enabled)));

            supportedSpServers.forEach((server) => {
                it(`preserves SP credentials and registry representation for ${server}`, async () => {
                    loginServer = server;
                    const provider = new ACRAuthenticationTokenProvider(endpointId, server);
                    const tokens = [provider.getAuthenticationToken(), await provider.getToken()];
                    tokens.forEach((token) => {
                        assert.strictEqual(token.getLoginServerUrl(), server);
                        assert.strictEqual(token.getUsername(), "fixture-client");
                        assert.strictEqual(token.getPassword(), "fixture-key");
                    });
                    const token = await getDockerRegistryEndpointAuthenticationToken(endpointId);
                    assert.strictEqual(token.getLoginServerUrl(), server.toLowerCase());
                    assert.strictEqual(token.getUsername(), "fixture-client");
                    assert.strictEqual(token.getPassword(), "fixture-key");
                    assert.deepStrictEqual(events, []);
                    assert.deepStrictEqual(warnings, []);
                });
            });

            absentConfigurations.forEach(([endpoint, server], index) => {
                it(`returns no authentication for absent optional configuration ${index}`, async () => {
                    const provider = new ACRAuthenticationTokenProvider(endpoint, server);
                    assert.strictEqual(provider.getAuthenticationToken(), null);
                    assert.strictEqual(await provider.getToken(), null);
                    assert.strictEqual(credentialReads, 0);
                    assert.deepStrictEqual(events, []);
                    assert.deepStrictEqual(warnings, []);
                });
            });

            for (const authScheme of ["WorkloadIdentityFederation", "ManagedServiceIdentity"]) {
                for (const fallback of [false, true]) {
                    it(`exchanges a bare hostname using ${authScheme}, parameter scheme ${fallback}`, async () => {
                        scheme = authScheme;
                        schemeInParameter = fallback;
                        const token = await getDockerRegistryEndpointAuthenticationToken(endpointId);
                        assert.strictEqual(token.getLoginServerUrl(), loginServer);
                        assert.strictEqual(token.getPassword(), "fixture-registry-token");
                        assert.deepStrictEqual(events, authScheme === "WorkloadIdentityFederation"
                            ? ["endpoint", "token", "exchange"] : ["token", "exchange"]);
                        assert.strictEqual(requests.length, 1);
                        assert.strictEqual(requests[0].uri, `https://${loginServer}/oauth2/exchange`);
                        assert.deepStrictEqual(warnings, []);
                    });
                }
            }
        });
    }

    describe("feature on rejects configured unsupported values", () => {
        beforeEach(() => tl.setVariable(featureVariable, "true"));

        unsupportedSpServers.forEach((server) => {
            it(`rejects SP registry syntax ${JSON.stringify(server)} before credential reads`, async () => {
                loginServer = server;
                const provider = new ACRAuthenticationTokenProvider(endpointId, server);
                const expected = new Error(tl.loc("InvalidRegistryHost", sanitizeUrl(server)));
                assert.throws(() => provider.getAuthenticationToken(), expected);
                await assert.rejects(provider.getToken(), expected);
                await assert.rejects(getDockerRegistryEndpointAuthenticationToken(endpointId), expected);
                assert.strictEqual(credentialReads, 0);
                assert.deepStrictEqual(events, []);
                assert.strictEqual(warnings.length, 3);
            });
        });

        partialConfigurations.forEach(([endpoint, server], index) => {
            it(`rejects partial configuration ${index} instead of treating it as absent`, async () => {
                const provider = new ACRAuthenticationTokenProvider(endpoint, server);
                const expected = new Error(tl.loc("InvalidRegistryHost", ""));
                assert.throws(() => provider.getAuthenticationToken(), expected);
                await assert.rejects(provider.getToken(), expected);
                assert.strictEqual(credentialReads, 0);
                assert.deepStrictEqual(events, []);
                assert.strictEqual(warnings.length, 2);
            });
        });

        for (const authScheme of ["WorkloadIdentityFederation", "ManagedServiceIdentity"]) {
            for (const server of ["other.example.com", "https://contoso.azurecr.io", ""]) {
                it(`rejects ${authScheme} host ${JSON.stringify(server)} before token acquisition`, async () => {
                    scheme = authScheme;
                    loginServer = server;
                    const provider = new ACRAuthenticationTokenProvider(endpointId, JSON.stringify({ loginServer }));
                    await assert.rejects(provider.getToken(),
                        new Error(tl.loc("InvalidRegistryHost", sanitizeUrl(server) || "")));
                    assert.strictEqual(credentialReads, 0);
                    assert.deepStrictEqual(events, []);
                    assert.strictEqual(warnings.length, 1);
                });
            }
        }
    });

    describe("feature off preserves existing configured behavior", () => {
        beforeEach(() => tl.setVariable(featureVariable, "false"));

        unsupportedSpServers.forEach((server) => {
            it(`preserves the SP result for ${JSON.stringify(server)}`, async () => {
                loginServer = server;
                const token = await getDockerRegistryEndpointAuthenticationToken(endpointId);
                assert.strictEqual(token.getLoginServerUrl(), server);
                assert.strictEqual(token.getPassword(), "fixture-key");
                assert.deepStrictEqual(events, []);
                assert.deepStrictEqual(warnings, []);
            });
        });

        partialConfigurations.forEach(([endpoint, server], index) => {
            it(`preserves the null result for partial configuration ${index}`, async () => {
                const provider = new ACRAuthenticationTokenProvider(endpoint, server);
                assert.strictEqual(provider.getAuthenticationToken(), null);
                assert.strictEqual(await provider.getToken(), null);
                assert.strictEqual(credentialReads, 0);
                assert.deepStrictEqual(events, []);
                assert.deepStrictEqual(warnings, []);
            });
        });

        for (const authScheme of ["WorkloadIdentityFederation", "ManagedServiceIdentity"]) {
            it(`preserves the ${authScheme} request without hostname normalization`, async () => {
                scheme = authScheme;
                loginServer = "https://contoso.azurecr.io";
                const token = await getDockerRegistryEndpointAuthenticationToken(endpointId);
                assert.strictEqual(token.getPassword(), "fixture-registry-token");
                assert.strictEqual(requests.length, 1);
                assert.strictEqual(requests[0].uri, `https://${loginServer}/oauth2/exchange`);
                assert.deepStrictEqual(warnings, []);
            });
        }
    });

    describe("feature unset preserves the default behavior", () => {
        beforeEach(() => { delete process.env[featureEnvironmentKey]; });

        it("returns SP credentials without enforcing the host restriction", async () => {
            loginServer = "other.example.com";
            const token = await getDockerRegistryEndpointAuthenticationToken(endpointId);
            assert.strictEqual(token.getLoginServerUrl(), loginServer);
            assert.strictEqual(token.getPassword(), "fixture-key");
            assert.deepStrictEqual(events, []);
            assert.deepStrictEqual(warnings, []);
        });

        it("returns no authentication for an optional unconfigured provider", async () => {
            const provider = new ACRAuthenticationTokenProvider();
            assert.strictEqual(provider.getAuthenticationToken(), null);
            assert.strictEqual(await provider.getToken(), null);
            assert.strictEqual(credentialReads, 0);
            assert.deepStrictEqual(events, []);
            assert.deepStrictEqual(warnings, []);
        });
    });
}
