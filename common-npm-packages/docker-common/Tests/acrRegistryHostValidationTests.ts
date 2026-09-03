// task-lib requires this variable during module initialization.
process.env['SYSTEM_DEFAULTWORKINGDIRECTORY'] = process.env['SYSTEM_DEFAULTWORKINGDIRECTORY'] || '/tmp/work';

import assert = require("assert");
import * as tl from "azure-pipelines-task-lib/task";
import { isAllowedAcrHost, shouldBlockRegistryHost, AcrHostValidationFeatureName } from "../registryauthenticationprovider/registryhostvalidation";

export function runAcrRegistryHostValidationTests() {

    describe("isAllowedAcrHost()", () => {

        const accepted = [
            "contoso.azurecr.io",
            "CONTOSO.AZURECR.IO",
            "my-registry.azurecr.io",
            "team.sub.azurecr.io",
            "contoso.azurecr.us",
            "contoso.azurecr.cn",
            "contoso.azurecr.de",
            "contoso.azurecr.io.",
        ];

        accepted.forEach((host) => {
            it(`accepts ${host}`, () => {
                assert.strictEqual(isAllowedAcrHost(host), true);
            });
        });

        const rejected = [
            "",
            "   ",
            "localhost",
            "example.com",
            "127.0.0.1",
            "127.0.0.1:8443",
            "contoso.azurecr.io:8443",
            "azurecr.io",
            "azurecr.us",
            "notazurecr.io",
            "contoso.azurecr.iox",
            "contoso.azurecr.io.example.com",
            "contoso.azurecr.io.example.org",
            "https://contoso.azurecr.io",
            "contoso.azurecr.io/oauth2/exchange",
            "user@contoso.azurecr.io",
            "contoso.azurecr.io@example.net",
            "contoso.azurecr.io example.com",
            " contoso.azurecr.io",
            "contoso.azurecr.io ",
        ];

        rejected.forEach((host) => {
            it(`rejects ${JSON.stringify(host)}`, () => {
                assert.strictEqual(isAllowedAcrHost(host), false);
            });
        });

        const airGapped = [
            "contoso.azurecr.eaglex.ic.gov",
            "contoso.azurecr.microsoft.scloud",
        ];

        airGapped.forEach((host) => {
            it(`accepts ${host}`, () => {
                assert.strictEqual(isAllowedAcrHost(host), true);
            });
        });

        it("rejects non-string inputs", () => {
            assert.strictEqual(isAllowedAcrHost(undefined as any), false);
            assert.strictEqual(isAllowedAcrHost(null as any), false);
            assert.strictEqual(isAllowedAcrHost(123 as any), false);
        });
    });

    describe("shouldBlockRegistryHost() (feature gate)", () => {
        const featureName = "AcrRegistryHostValidation";
        const featureVariable = "DistributedTask.Tasks." + featureName;

        function setFeature(enabled: boolean): void {
            tl.setVariable(featureVariable, enabled ? "true" : "false");
        }

        afterEach(() => {
            setFeature(false);
        });

        // Prevent accidental changes to the production feature-variable name.
        it("exposes the expected feature name", () => {
            assert.strictEqual(AcrHostValidationFeatureName, featureName);
        });

        it("feature ON + non-ACR host: blocks the request", () => {
            setFeature(true);
            assert.strictEqual(shouldBlockRegistryHost("other.example.com"), true);
        });

        it("feature ON + valid ACR host: does not block", () => {
            setFeature(true);
            assert.strictEqual(shouldBlockRegistryHost("contoso.azurecr.io"), false);
        });

        it("feature OFF + non-ACR host: does not block (behavior unchanged)", () => {
            setFeature(false);
            assert.strictEqual(shouldBlockRegistryHost("other.example.com"), false);
        });
    });
}
