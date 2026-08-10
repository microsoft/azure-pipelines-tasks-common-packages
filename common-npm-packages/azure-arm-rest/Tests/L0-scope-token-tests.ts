import assert = require("assert");
import * as ttm from 'azure-pipelines-task-lib/mock-test';
import * as path from 'path';

export function ScopeTokenTests(defaultTimeout = 2000) {
    it('acquireTokenForScope falls back to an ARM-audience token and emits telemetry', function (done: Mocha.Done) {
        this.timeout(defaultTimeout);
        let tp = path.join(__dirname, 'scope-token-tests.js');
        let tr: ttm.MockTestRunner = new ttm.MockTestRunner(tp);

        tr.runAsync()
            .then(() => {
                assert(tr.succeeded, "scope-token-tests should have passed but failed.");

                console.log("\tvalidating scoped token success");
                scopedTokenSuccess(tr);
                console.log("\tvalidating scoped token success on Node <16 (MSAL path)");
                scopedTokenSuccessOnLegacyNode(tr);
                console.log("\tvalidating fallback when the feature is disabled");
                fallbackWhenFeatureDisabled(tr);
                console.log("\tvalidating fallback (with warning) when the scope is unmapped");
                fallbackWhenScopeUnmapped(tr);
                console.log("\tvalidating scoped token acquisition failure");
                scopedTokenFailure(tr);

                done();
            })
            .catch((error) => {
                console.log(tr.stdout);
                console.log(tr.stderr);
                done(error);
            });
    });
}

function scopedTokenSuccess(tr: ttm.MockTestRunner) {
    assert(tr.stdOutContained('SCOPED_TOKEN: DUMMY_APPSERVICE_TOKEN'),
        'Should have returned the App Service-audience token when the scope is mapped');
    assert(tr.stdOutContained('"requestedAudience":"AppService"'),
        'Scoped telemetry should record the App Service audience');
    assert(tr.stdOutContained('"outcome":"scoped"'),
        'Should have emitted telemetry with outcome scoped');
}

function scopedTokenSuccessOnLegacyNode(tr: ttm.MockTestRunner) {
    assert(tr.stdOutContained('SCOPED_TOKEN_LEGACY_NODE: DUMMY_APPSERVICE_TOKEN_VIA_MSAL'),
        'Should have returned the App Service-audience token via MSAL when @azure/identity is unavailable (Node <16)');
    assert(tr.stdOutContained('using MSAL to acquire scoped token instead of @azure/identity'),
        'Should have logged that MSAL is used instead of @azure/identity');
}

// Feature disabled: returns the ARM-audience token, records outcome "fallbackDisabled", no warning.
function fallbackWhenFeatureDisabled(tr: ttm.MockTestRunner) {
    assert(tr.stdOutContained('FALLBACK_DISABLED_TOKEN: DUMMY_ACCESS_TOKEN'),
        'Should have returned the ARM-audience token when the feature is disabled');
    assert(tr.stdOutContained('"outcome":"fallbackDisabled"'),
        'Should have emitted telemetry with outcome fallbackDisabled');
    assert(tr.stdOutContained('feature=KuduScopeLevelToken'),
        'Should have emitted KuduScopeLevelToken telemetry');
}

// Feature enabled but no scope mapped: warns, then returns the ARM-audience token, outcome "fallbackUnmapped".
function fallbackWhenScopeUnmapped(tr: ttm.MockTestRunner) {
    assert(tr.stdOutContained('FALLBACK_UNMAPPED_TOKEN: DUMMY_ACCESS_TOKEN'),
        'Should have returned the ARM-audience token when the scope is unmapped');
    assert(tr.stdOutContained('falling back to an ARM-audience token'),
        'Should have warned when the feature is enabled but the scope is unmapped');
    assert(tr.stdOutContained('"outcome":"fallbackUnmapped"'),
        'Should have emitted telemetry with outcome fallbackUnmapped');
    assert(tr.stdOutContained('"requestedAudience":"ARM"'),
        'Fallback telemetry should record the ARM audience');
}

function scopedTokenFailure(tr: ttm.MockTestRunner) {
    assert(tr.stdOutContained('SCOPED_TOKEN_ERROR:'),
        'Should have surfaced the scoped token acquisition failure');
    assert(tr.stdOutContained('"requestedAudience":"None"'),
        'Failure telemetry should not report an ARM audience');
    assert(tr.stdOutContained('"outcome":"error"'),
        'Should have emitted telemetry with outcome error');
}
