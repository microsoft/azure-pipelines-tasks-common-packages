import { ApplicationTokenCredentials } from '../azure-arm-common';

async function RUNTESTS() {
    const applicationTokenCredentials = new ApplicationTokenCredentials(
        "MOCK_SERVICE_CONNECTION",
        "MOCK_SPN_ID",
        "MOCK_TENANT_ID",
        "MOCK_SPN_KEY",
        "https://management.azure.com/",
        "https://login.windows.net/",
        "https://management.azure.com/",
        false
    );
    console.log(applicationTokenCredentials.getOpenSSLPath());
}

RUNTESTS();