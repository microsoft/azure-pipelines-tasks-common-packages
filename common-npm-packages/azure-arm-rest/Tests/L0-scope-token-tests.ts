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

                console.log("\tvalidating fallback when the feature is disabled");
                fallbackWhenFeatureDisabled(tr);
                console.log("\tvalidating fallback (with warning) when the scope is unmapped");
                fallbackWhenScopeUnmapped(tr);

                done();
            })
            .catch((error) => {
                console.log(tr.stdout);
                console.log(tr.stderr);
                done(error);
            });
    });
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
