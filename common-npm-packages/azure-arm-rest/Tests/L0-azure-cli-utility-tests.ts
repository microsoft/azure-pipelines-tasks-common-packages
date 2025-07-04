import assert = require('assert');
import { join } from 'path';

import { MockTestRunner } from 'azure-pipelines-task-lib/mock-test';

export function AzureCliUtilityTests() {
    it('azure-arm-rest azure-cli-utility check retry count', (done: Mocha.Done) => {
        process.env['SYSTEM_DEBUG'] = 'true';

        const tr = new MockTestRunner(join(__dirname, 'azure-cli-utility-tests.js'));

        tr.runAsync()
            .then(() => {
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
