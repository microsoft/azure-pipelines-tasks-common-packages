import assert = require('assert');
import { join } from 'path';

import { MockTestRunner } from 'azure-pipelines-task-lib/mock-test';

export function AzureCliUtilityTests() {
    it('azure-arm-rest azure-cli-utility check retry count', (done: Mocha.Done) => {
        process.env['SYSTEM_DEBUG'] = 'true';

        const tr = new MockTestRunner(join(__dirname, 'azure-cli-utility-tests.js'));

        tr.runAsync()
            .then(() => {
                assert(tr.stdOutContained('ALL_AZURE_CLI_INVOCATIONS_USE_RESOLVED_PATH'));
                assert(tr.stdOutContained('CERTIFICATE_LOGIN_LEGACY_PASSED'), 'legacy certificate login');
                assert(tr.stdOutContained('CERTIFICATE_LOGIN_ISOLATED_PASSED'), 'isolated certificate login');
                assert(tr.stdOutContained('CERTIFICATE_LOGIN_ISOLATED_DISABLE_FLAG_OFF_PASSED'), 'isolated certificate login when disable flag is false');
                assert(tr.stdOutContained('CERTIFICATE_LOGIN_ISOLATED_LOGIN_FAILURE_PASSED'), 'isolated certificate login failure');
                assert(tr.stdOutContained('CERTIFICATE_LOGIN_ISOLATED_NO_AGENT_TEMP_PASSED'), 'isolated certificate without Agent.TempDirectory');
                assert(tr.stdOutContained('CLEANUP_REJECTS_UNSAFE_DIRECTORY_PASSED'), 'cleanup rejects unsafe credential directories');
                assert(tr.stdOutContained('Retrying OIDC token fetch. Retries left: 2'));
                assert(tr.stdOutContained('Retrying OIDC token fetch. Retries left: 0'));
                assert(tr.stdOutContained('Error while trying to get OIDC token: Error: 1'));
                assert(tr.stdOutContained('Error while trying to get OIDC token: Error: 2'));
                assert(tr.stdOutContained('Error while trying to get OIDC token: Error: 3'));
                done();
            })
            .catch((error) => {
                console.log(tr.stdout);
                console.log(tr.stderr);
                done(error);
            });
    });
}
