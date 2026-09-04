// Provider-level checks that the host gate is enforced at BOTH public entry points
// (getToken and getAuthenticationToken). The agent temp/working-dir env must be set
// before importing the provider, which transitively loads azure-arm-rest.
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

    // registerNameValue is a raw host string (not JSON), so registryURL === host.
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

        it("feature OFF + non-ACR host: does not throw (behavior unchanged)", () => {
            setFeature(false);
            assert.doesNotThrow(() => providerFor("other.example.com").getAuthenticationToken());
        });

        it("feature ON + empty host: does not throw (returns null)", () => {
            setFeature(true);
            assert.strictEqual(providerFor("").getAuthenticationToken(), null);
        });
    });

    describe("getToken() (gate runs before the auth-scheme dispatch, so it covers all schemes)", () => {
        it("feature ON + non-ACR host: rejects before dispatching on scheme", (done) => {
            setFeature(true);
            providerFor("other.example.com").getToken().then(
                () => done(new Error("expected the call to be rejected")),
                (err: any) => {
                    try { assert.ok(err && String(err.message).length > 0); done(); }
                    catch (e) { done(e); }
                }
            );
        });

        it("feature OFF + non-ACR host: does not reject at the gate (behavior unchanged)", (done) => {
            setFeature(false);
            providerFor("other.example.com").getToken().then(
                () => done(),
                (err: any) => done(err)
            );
        });
    });
}
