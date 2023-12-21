import { KuduServiceTests } from "./L0-azure-arm-app-service-kudu-tests";
import { AzureAppServiceMockTests } from "./L0-azure-arm-app-service";
import { ApplicationInsightsTests } from "./L0-azure-arm-appinsights-tests";
import { ApplicationInsightsWebTestsTests } from "./L0-azure-arm-appinsights-webtests-tests";
import { ResourcesTests } from "./L0-azure-arm-resource-tests";

describe("azure-arm-rest suite", async function() {
    describe("kuduService", KuduServiceTests);
    describe("azureAppService", AzureAppServiceMockTests);
    describe("applicationInsihts", ApplicationInsightsTests);
    describe("applicationInsightsWebTests", ApplicationInsightsWebTestsTests);
    describe("resources", ResourcesTests);
});
