import { AzureAppService } from '../azure-arm-app-service';
import { AzureAppServiceUtility } from '../azureAppServiceUtility';
import { getMockEndpoint, mockAzureAppServiceTests, mockAzureAppServiceUtilityTests } from './mock_utils';
import tl = require('azure-pipelines-task-lib/task');

var endpoint = getMockEndpoint();

mockAzureAppServiceTests();
mockAzureAppServiceUtilityTests();

class AzureAppServiceUtilityTests {

    public static async getKuduServiceWithoutWarmupInstanceId() {
        var appService: AzureAppService = new AzureAppService(endpoint, "MOCK_RESOURCE_GROUP_NAME", "MOCK_APP_SERVICE_NAME");
        var appServiceUtility: AzureAppServiceUtility = new AzureAppServiceUtility(appService);

        try {
            var kudu = await appServiceUtility.getKuduService();
            console.log('KUDU SERVICE CREATED WITHOUT WARMUP INSTANCE ID');
            console.log('KUDU SCM URI: ' + (kudu ? 'VALID' : 'INVALID'));
        }
        catch(error) {
            console.log(error);
            tl.setResult(tl.TaskResult.Failed, 'AzureAppServiceUtilityTests.getKuduServiceWithoutWarmupInstanceId() should have passed but failed');
        }
    }

    public static async getKuduServiceWithWarmupInstanceId() {
        var appService: AzureAppService = new AzureAppService(endpoint, "MOCK_RESOURCE_GROUP_NAME", "MOCK_APP_SERVICE_NAME");
        var appServiceUtility: AzureAppServiceUtility = new AzureAppServiceUtility(appService);

        try {
            var kudu = await appServiceUtility.getKuduService("MOCK_INSTANCE_ID_123");
            console.log('KUDU SERVICE CREATED WITH WARMUP INSTANCE ID: MOCK_INSTANCE_ID_123');
            console.log('KUDU SCM URI WITH COOKIE: ' + (kudu ? 'VALID' : 'INVALID'));
        }
        catch(error) {
            console.log(error);
            tl.setResult(tl.TaskResult.Failed, 'AzureAppServiceUtilityTests.getKuduServiceWithWarmupInstanceId() should have passed but failed');
        }
    }

    public static async getKuduServiceWithEmptyScmUri() {
        var appService: AzureAppService = new AzureAppService(endpoint, "MOCK_RESOURCE_GROUP_NAME", "MOCK_APP_SERVICE_NAME_NO_SCM");
        var appServiceUtility: AzureAppServiceUtility = new AzureAppServiceUtility(appService);

        try {
            await appServiceUtility.getKuduService();
            tl.setResult(tl.TaskResult.Failed, 'AzureAppServiceUtilityTests.getKuduServiceWithEmptyScmUri() should have failed but passed');
        }
        catch(error) {
            console.log('KUDU SERVICE FAILED AS EXPECTED FOR EMPTY SCM URI');
            console.log(error);
        }
    }

    public static async getAppserviceInstances() {
        var appService: AzureAppService = new AzureAppService(endpoint, "MOCK_RESOURCE_GROUP_NAME", "MOCK_APP_SERVICE_NAME");
        var appServiceUtility: AzureAppServiceUtility = new AzureAppServiceUtility(appService);

        try {
            var instances = await appServiceUtility.getAppserviceInstances();
            console.log('APP SERVICE INSTANCES COUNT: ' + instances.value.length);
            console.log('APP SERVICE INSTANCE NAMES: ' + instances.value.map((i: any) => i.name).join(', '));
        }
        catch(error) {
            console.log(error);
            tl.setResult(tl.TaskResult.Failed, 'AzureAppServiceUtilityTests.getAppserviceInstances() should have passed but failed');
        }
    }

    public static async getAppserviceInstancesForSlot() {
        var appServiceSlot: AzureAppService = new AzureAppService(endpoint, "MOCK_RESOURCE_GROUP_NAME", "MOCK_APP_SERVICE_NAME", "MOCK_SLOT_NAME");
        var appServiceUtility: AzureAppServiceUtility = new AzureAppServiceUtility(appServiceSlot);

        try {
            await appServiceUtility.getAppserviceInstances();
            tl.setResult(tl.TaskResult.Failed, 'AzureAppServiceUtilityTests.getAppserviceInstancesForSlot() should have failed but passed');
        }
        catch(error) {
            console.log('GET INSTANCES FOR SLOT FAILED AS EXPECTED');
            console.log(error);
        }
    }

    public static async getAppserviceInstancesEmpty() {
        var appService: AzureAppService = new AzureAppService(endpoint, "MOCK_RESOURCE_GROUP_NAME", "MOCK_APP_SERVICE_NAME_NO_INSTANCES");
        var appServiceUtility: AzureAppServiceUtility = new AzureAppServiceUtility(appService);

        try {
            var instances = await appServiceUtility.getAppserviceInstances();
            console.log('APP SERVICE INSTANCES EMPTY COUNT: ' + instances.value.length);
        }
        catch(error) {
            console.log(error);
            tl.setResult(tl.TaskResult.Failed, 'AzureAppServiceUtilityTests.getAppserviceInstancesEmpty() should have passed but failed');
        }
    }
}

async function RUNTESTS() {
    await AzureAppServiceUtilityTests.getKuduServiceWithoutWarmupInstanceId();
    await AzureAppServiceUtilityTests.getKuduServiceWithWarmupInstanceId();
    await AzureAppServiceUtilityTests.getKuduServiceWithEmptyScmUri();
    await AzureAppServiceUtilityTests.getAppserviceInstances();
    await AzureAppServiceUtilityTests.getAppserviceInstancesForSlot();
    await AzureAppServiceUtilityTests.getAppserviceInstancesEmpty();
}

RUNTESTS();
