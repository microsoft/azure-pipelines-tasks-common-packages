import { ApplicationTokenCredentials } from '../azure-arm-common';
import { getMockEndpoint } from './mock_utils';
import tl = require('azure-pipelines-task-lib/task');

// Installs the ARM (ADAL) nock interceptor that answers the client-credentials token
// request with "DUMMY_ACCESS_TOKEN". This is the ARM-audience token that acquireTokenForScope
// must return whenever it falls back (feature disabled or scope unmapped).
getMockEndpoint();

// Builds a Service Principal (key) credential wired to the same tenant/authority/secret the
// mock nock interceptor expects. useMSAL=false forces the ADAL path so getToken() is served
// by nock rather than a real network/MSAL call.
function makeCreds(allowScopeLevelToken: boolean, scopes: any): ApplicationTokenCredentials {
    return new ApplicationTokenCredentials(
        "MOCK_SERVICE_CONNECTION",
        "MOCK_SPN_ID",
        "MOCK_TENANT_ID",
        "MOCK_SPN_KEY",
        "https://management.azure.com/",
        "https://login.windows.net/",
        "https://management.azure.com/",
        false,
        undefined,   // scheme -> ServicePrincipal
        undefined,   // msiClientId
        undefined,   // authType -> servicePrincipalKey
        undefined,   // certFilePath
        undefined,   // isADFSEnabled
        undefined,   // access_token
        false,       // useMSAL -> ADAL path (served by nock)
        allowScopeLevelToken,
        scopes
    );
}

class ScopeTokenTests {
    // Feature disabled -> returns the ARM-audience token, no warning.
    public static async fallbackWhenFeatureDisabled() {
        try {
            const creds = makeCreds(false, undefined);
            const token = await creds.acquireTokenForScope("appservice");
            console.log('FALLBACK_DISABLED_TOKEN: ' + token);
        } catch (error) {
            console.log(error);
            tl.setResult(tl.TaskResult.Failed, 'fallbackWhenFeatureDisabled should have passed but failed');
        }
    }

    // Feature enabled but no scope mapped for this environment -> warns, then falls back to ARM.
    public static async fallbackWhenScopeUnmapped() {
        try {
            const creds = makeCreds(true, {}); // no 'appservice' key
            const token = await creds.acquireTokenForScope("appservice");
            console.log('FALLBACK_UNMAPPED_TOKEN: ' + token);
        } catch (error) {
            console.log(error);
            tl.setResult(tl.TaskResult.Failed, 'fallbackWhenScopeUnmapped should have passed but failed');
        }
    }
}

async function RUNTESTS() {
    await ScopeTokenTests.fallbackWhenFeatureDisabled();
    await ScopeTokenTests.fallbackWhenScopeUnmapped();
}

RUNTESTS();
