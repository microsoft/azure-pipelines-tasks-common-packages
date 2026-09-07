// Set agent env before importing the provider (it transitively loads azure-arm-rest).
process.env["SYSTEM_DEFAULTWORKINGDIRECTORY"] = process.env["SYSTEM_DEFAULTWORKINGDIRECTORY"] || require("os").tmpdir();
process.env["AGENT_TEMPDIRECTORY"] = process.env["AGENT_TEMPDIRECTORY"] || require("os").tmpdir();

import assert = require("assert");
import * as tl from "azure-pipelines-task-lib/task";
import ACRAuthenticationTokenProvider from "../registryauthenticationprovider/acrauthenticationtokenprovider";

export function runAcrProviderHostValidationTests() {

    const featureVariable = "DistributedTask.Tasks.AcrRegistryHostValidation";

    function setFeature(enabled: boolean): void {
        tl.setVariable(featureVariable, enabled ? "true" : "false");
    }

    // Raw (non-JSON) host string, so registryURL === host.
    function providerFor(host: string): any {
        return new ACRAuthenticationTokenProvider("endpoint", host);
    }

    afterEach(() => {
        setFeature(false);
    });

    describe("getAuthenticationToken() (service-principal path)", () => {
        it("feature ON + non-ACR host: throws", () => {
            setFeature(true);
            assert.throws(() => providerFor("other.example.com").getAuthenticationToken());
        });

        it("feature ON + valid ACR host: does not throw", () => {
            setFeature(true);
            assert.doesNotThrow(() => providerFor("contoso.azurecr.io").getAuthenticationToken());
        });
    });

    describe("getToken() (host guarded on every auth-scheme path)", () => {
        it("feature ON + non-ACR host: rejects", (done) => {
            setFeature(true);
            providerFor("other.example.com").getToken().then(
                () => done(new Error("expected the call to be rejected")),
                (err: any) => {
                    try { assert.ok(err && String(err.message).length > 0); done(); }
                    catch (e) { done(e); }
                }
            );
        });

        it("feature OFF + non-ACR host: does not warn or reject (inert)", (done) => {
            setFeature(false);
            providerFor("other.example.com").getToken().then(
                () => done(),
                (err: any) => done(err)
            );
        });
    });

    describe("audit warning (no double-warn)", () => {
        // Guarding each path once means the SP-via-getToken path warns once, not twice.
        it("getToken() service-principal path warns exactly once", (done) => {
            setFeature(true); // enforcing: warn (endpoint id + scheme), then throw
            const original = process.stdout.write;
            let out = "";
            (process.stdout.write as any) = (chunk: any) => { out += chunk.toString(); return true; };
            providerFor("other.example.com").getToken().then(
                () => { (process.stdout.write as any) = original; done(new Error("expected the call to be rejected")); },
                () => {
                    (process.stdout.write as any) = original;
                    try {
                        const warnings = out.split("task.issue type=warning").length - 1;
                        assert.strictEqual(warnings, 1, "expected exactly one warning (no double-warn)");
                        done();
                    } catch (e) { done(e); }
                }
            );
        });
    });
}
