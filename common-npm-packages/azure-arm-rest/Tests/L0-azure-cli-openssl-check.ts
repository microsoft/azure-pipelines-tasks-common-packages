import assert = require('assert');
import { join } from 'path';

import { MockTestRunner } from 'azure-pipelines-task-lib/mock-test';
import { existsSync } from 'fs';

export function OpenSSLCheck() {
    if (process.platform !== 'win32') {
        console.log('Skipping OpenSSL tests on non-Windows platform');
        return;
    }

    [{
        openSSLVersion: '3.4.2',
        featureFlagValue: false
    }, {
        openSSLVersion: '3.6.1',
        featureFlagValue: true
    }].forEach(({ openSSLVersion, featureFlagValue }) => {
        it(`azure-arm-rest check openssl path openssl${openSSLVersion}`, (done: Mocha.Done) => {
            process.env['SYSTEM_DEBUG'] = 'true';
            process.env['DISTRIBUTEDTASK_TASKS_USELATESTOPENSSLINAZUREARMREST'] = featureFlagValue.toString();

            const tr = new MockTestRunner(join(__dirname, 'azure-cli-openssl-tests.js'));
            const openSSLRelativePath = join(`openssl${openSSLVersion}`, 'openssl.exe');
            const openSSLAbsolutePath = join(__dirname, '..', openSSLRelativePath);

            tr.runAsync()
                .then(() => {
                    assert(tr.stdOutContained(openSSLRelativePath), 'Should have printed: openssl path');
                    assert(tr.succeeded, 'Test runner should have succeeded');
                    assert(existsSync(openSSLAbsolutePath), `Should have existed openssl${openSSLVersion} at ${openSSLAbsolutePath}`);
                    done();
                })
                .catch((error) => {
                    console.log(tr.stdout);
                    console.log(tr.stderr);
                    done(error);
                });
        });
    });
}
