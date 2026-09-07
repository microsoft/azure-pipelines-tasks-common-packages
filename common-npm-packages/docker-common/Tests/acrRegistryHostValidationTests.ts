// task-lib requires this variable during module initialization.
process.env['SYSTEM_DEFAULTWORKINGDIRECTORY'] = process.env['SYSTEM_DEFAULTWORKINGDIRECTORY'] || '/tmp/work';

import assert = require("assert");
import * as tl from "azure-pipelines-task-lib/task";
import { isAllowedAcrHost, guardRegistryHost, AcrHostValidationFeatureName } from "../registryauthenticationprovider/registryhostvalidation";

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
            "",                                   // empty / absent
            "localhost",                          // single label, no suffix
            "example.com",                        // well-formed host, not an ACR suffix
            "contoso.azurecr.io:8443",            // port
            "azurecr.io",                         // bare suffix, no subdomain
            "notazurecr.io",                      // suffix not on a label boundary
            "contoso.azurecr.iox",                // look-alike suffix
            "contoso.azurecr.io.example.com",     // real host is example.com
            "https://contoso.azurecr.io",         // scheme / URL syntax
            "contoso.azurecr.io@example.net",     // real host is example.net
            " contoso.azurecr.io",                // leading space must not be trimmed then accepted
            "contoso.azurecr.io ",                // trailing space
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

    describe("guardRegistryHost() (enforce)", () => {
        const enforceVariable = "DistributedTask.Tasks." + AcrHostValidationFeatureName;

        function setEnforce(enabled: boolean): void {
            tl.setVariable(enforceVariable, enabled ? "true" : "false");
        }

        afterEach(() => setEnforce(false));

        // Prevent accidental changes to the production feature-variable name.
        it("exposes the expected enforce feature name", () => {
            assert.strictEqual(AcrHostValidationFeatureName, "AcrRegistryHostValidation");
        });

        it("enforce ON + non-ACR host: throws", () => {
            setEnforce(true);
            assert.throws(() => guardRegistryHost("other.example.com", "endpoint-abc", "ServicePrincipal"));
        });

        it("enforce ON + valid ACR host: does not throw", () => {
            setEnforce(true);
            assert.doesNotThrow(() => guardRegistryHost("contoso.azurecr.io", "endpoint-abc", "ServicePrincipal"));
        });

        it("enforce OFF + non-ACR host: does not throw (inert)", () => {
            setEnforce(false);
            assert.doesNotThrow(() => guardRegistryHost("other.example.com", "endpoint-abc", "ServicePrincipal"));
        });

        it("enforce ON + empty/absent host: does not throw", () => {
            setEnforce(true);
            assert.doesNotThrow(() => guardRegistryHost("", "endpoint-abc", "ServicePrincipal"));
            assert.doesNotThrow(() => guardRegistryHost(undefined as any, "endpoint-abc", "ServicePrincipal"));
        });
    });

    describe("guardRegistryHost() (audit warning)", () => {
        const enforceVariable = "DistributedTask.Tasks." + AcrHostValidationFeatureName;

        function setEnforce(enabled: boolean): void {
            tl.setVariable(enforceVariable, enabled ? "true" : "false");
        }

        // Feature-variable is set before capturing. The guard throws after warning when enforcing,
        // so the throw is swallowed here to inspect the emitted warning on stdout.
        function capture(fn: () => void): string {
            const original = process.stdout.write;
            let out = "";
            (process.stdout.write as any) = (chunk: any) => { out += chunk.toString(); return true; };
            try { fn(); } catch (e) { /* inspect the warning, not the throw */ } finally { (process.stdout.write as any) = original; }
            return out;
        }

        afterEach(() => setEnforce(false));

        it("enforcing + non-ACR host: warns with the host, endpoint id, and scheme", () => {
            setEnforce(true);
            const host = "other.example.com";
            const expected = tl.loc("UnrecognizedRegistryHost", host, "endpoint-abc", "ServicePrincipal");
            const out = capture(() => guardRegistryHost(host, "endpoint-abc", "ServicePrincipal"));
            assert.ok(out.indexOf("task.issue type=warning") !== -1, "expected a warning");
            assert.ok(out.indexOf(expected) !== -1, "warning should contain the host, endpoint id, and scheme");
        });

        it("not enforcing + non-ACR host: no warning (inert)", () => {
            setEnforce(false);
            const out = capture(() => guardRegistryHost("other.example.com", "endpoint-abc", "ServicePrincipal"));
            assert.strictEqual(out.indexOf("task.issue type=warning"), -1);
        });
    });
}
