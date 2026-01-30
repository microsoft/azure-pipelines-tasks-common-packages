import assert = require("assert");
import * as ttm from 'azure-pipelines-task-lib/mock-test';
import * as path from 'path';

export function AzureAppServiceUtilityTests(defaultTimeout = 2000) {
    it('azure-app-service-utility AzureAppServiceUtility', function (done: Mocha.Done) {
        this.timeout(defaultTimeout);
        let tp = path.join(__dirname, 'azure-app-service-utility-tests.js');
        let tr: ttm.MockTestRunner = new ttm.MockTestRunner(tp);
        let passed: boolean = true;

        tr.runAsync()
            .then(() => {
                assert(tr.succeeded, "azure-app-service-utility-tests should have passed but failed.");
                console.log("\tvalidating getKuduServiceWithoutWarmupInstanceId");
                getKuduServiceWithoutWarmupInstanceId(tr);
                console.log("\tvalidating getKuduServiceWithWarmupInstanceId");
                getKuduServiceWithWarmupInstanceId(tr);
                console.log("\tvalidating getKuduServiceWithEmptyScmUri");
                getKuduServiceWithEmptyScmUri(tr);
                console.log("\tvalidating getAppserviceInstances");
                getAppserviceInstances(tr);
                console.log("\tvalidating getAppserviceInstancesForSlot");
                getAppserviceInstancesForSlot(tr);
                console.log("\tvalidating getAppserviceInstancesEmpty");
                getAppserviceInstancesEmpty(tr);
                done();
            })
            .catch((error) => {
                passed = false;
                console.log(tr.stdout);
                console.log(tr.stderr);
                done(error);
            });
    });
}

function getKuduServiceWithoutWarmupInstanceId(tr: ttm.MockTestRunner) {
    assert(tr.stdOutContained('KUDU SERVICE CREATED WITHOUT WARMUP INSTANCE ID'),
        'Should have printed: KUDU SERVICE CREATED WITHOUT WARMUP INSTANCE ID');
    assert(tr.stdOutContained('KUDU SCM URI: VALID'),
        'Should have printed: KUDU SCM URI: VALID');
}

function getKuduServiceWithWarmupInstanceId(tr: ttm.MockTestRunner) {
    assert(tr.stdOutContained('KUDU SERVICE CREATED WITH WARMUP INSTANCE ID: MOCK_INSTANCE_ID_123'),
        'Should have printed: KUDU SERVICE CREATED WITH WARMUP INSTANCE ID: MOCK_INSTANCE_ID_123');
    assert(tr.stdOutContained('KUDU SCM URI WITH COOKIE: VALID'),
        'Should have printed: KUDU SCM URI WITH COOKIE: VALID');
}

function getKuduServiceWithEmptyScmUri(tr: ttm.MockTestRunner) {
    assert(tr.stdOutContained('KUDU SERVICE FAILED AS EXPECTED FOR EMPTY SCM URI'),
        'Should have printed: KUDU SERVICE FAILED AS EXPECTED FOR EMPTY SCM URI');
}

function getAppserviceInstances(tr: ttm.MockTestRunner) {
    assert(tr.stdOutContained('APP SERVICE INSTANCES COUNT: 3'),
        'Should have printed: APP SERVICE INSTANCES COUNT: 3');
    assert(tr.stdOutContained('APP SERVICE INSTANCE NAMES: instance-1, instance-2, instance-3'),
        'Should have printed: APP SERVICE INSTANCE NAMES: instance-1, instance-2, instance-3');
}

function getAppserviceInstancesForSlot(tr: ttm.MockTestRunner) {
    assert(tr.stdOutContained('GET INSTANCES FOR SLOT FAILED AS EXPECTED'),
        'Should have printed: GET INSTANCES FOR SLOT FAILED AS EXPECTED');
}

function getAppserviceInstancesEmpty(tr: ttm.MockTestRunner) {
    assert(tr.stdOutContained('APP SERVICE INSTANCES EMPTY COUNT: 0'),
        'Should have printed: APP SERVICE INSTANCES EMPTY COUNT: 0');
}
