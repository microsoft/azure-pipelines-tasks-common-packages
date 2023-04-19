import { KuduTests } from './azure-arm-app-service-kudu-tests';
import { KuduServiceTests } from './L0-azure-arm-app-service-kudu-tests';
import { AzureAppServiceMockTests } from './L0-azure-arm-app-service';
import { ApplicationInsightsTests } from './L0-azure-arm-appinsights-tests';
import { ResourcesTests } from './L0-azure-arm-resource-tests';
import { getMockEndpoint } from './mock_utils';


describe('azurermdeploycommon suite', () => {
    describe('L0-azure-arm-app-service-kudu-tests', KuduServiceTests);
    describe('L0-azure-arm-app-service', AzureAppServiceMockTests);
    describe('L0-azure-arm-appinsights-tests', ApplicationInsightsTests);
    describe('L0-azure-arm-resource-tests', ResourcesTests);
    describe('mock_utils', getMockEndpoint);
});