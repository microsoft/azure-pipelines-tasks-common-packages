import * as fs from 'fs';
import * as path from 'path';

// Usage: node azure-arm-endpoint-certificate-tests.js <agentTempDirectory> <isolated|legacy|exit|link>
const agentTempDirectory = process.argv[2];
const scenario = process.argv[3];
const connection = 'CERTCONNECTION';
const certificate = '-----BEGIN PRIVATE KEY-----\nMOCK\n-----END PRIVATE KEY-----';

process.env['AGENT_TEMPDIRECTORY'] = agentTempDirectory;
process.env[`ENDPOINT_AUTH_SCHEME_${connection}`] = 'ServicePrincipal';
process.env[`ENDPOINT_AUTH_PARAMETER_${connection}_SERVICEPRINCIPALID`] = 'client-id';
process.env[`ENDPOINT_AUTH_PARAMETER_${connection}_TENANTID`] = 'tenant-id';
process.env[`ENDPOINT_AUTH_PARAMETER_${connection}_AUTHENTICATIONTYPE`] = 'spnCertificate';
process.env[`ENDPOINT_AUTH_PARAMETER_${connection}_SERVICEPRINCIPALCERTIFICATE`] = certificate;
process.env[`ENDPOINT_DATA_${connection}_SUBSCRIPTIONID`] = 'subscription-id';
process.env[`ENDPOINT_DATA_${connection}_SUBSCRIPTIONNAME`] = 'subscription';
process.env[`ENDPOINT_DATA_${connection}_ENVIRONMENT`] = 'AzureCloud';
process.env[`ENDPOINT_URL_${connection}`] = 'https://management.azure.com/';
if (scenario === 'legacy') {
    process.env['DISTRIBUTEDTASK_TASKS_DISABLEAZUREARMENDPOINTCREDENTIALFILEISOLATION'] = 'true';
}

import { AzureRMEndpoint, dispose } from '../azure-arm-endpoint';

function check(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

async function run(): Promise<void> {
    const legacyPath = path.join(agentTempDirectory, 'spnCert.pem');
    const endpoint = await new AzureRMEndpoint(connection).getEndpoint();
    const certificatePath = endpoint.servicePrincipalCertificatePath;
    check(fs.readFileSync(certificatePath, 'utf8') === certificate, 'certificate content mismatch');

    if (scenario === 'legacy') {
        check(certificatePath === legacyPath, 'legacy path not used');
        dispose();
        check(!fs.existsSync(legacyPath), 'legacy certificate not removed');
    } else {
        const directoryPath = path.dirname(certificatePath);
        check(path.dirname(directoryPath) === agentTempDirectory, 'isolated directory not in agent temp');
        check(path.basename(directoryPath).indexOf('.azarmrest-endpoint-') === 0, 'unexpected directory name');
        check(!fs.existsSync(legacyPath), 'legacy certificate created');
        if (process.platform !== 'win32') {
            check((fs.statSync(directoryPath).mode & 0o777) === 0o700, 'directory permissions not restricted');
            check((fs.statSync(certificatePath).mode & 0o777) === 0o600, 'certificate permissions not restricted');
        }

        const secondEndpoint = await new AzureRMEndpoint(connection).getEndpoint();
        check(secondEndpoint.servicePrincipalCertificatePath !== certificatePath, 'certificate path is not unique per endpoint');

        if (scenario === 'isolated') {
            dispose();
            check(!fs.existsSync(directoryPath), 'isolated directory not removed');
            check(!fs.existsSync(path.dirname(secondEndpoint.servicePrincipalCertificatePath)), 'second isolated directory not removed');
            dispose();
        } else if (scenario === 'link') {
            const victimDirectory = fs.mkdtempSync(path.join(agentTempDirectory, 'victim-'));
            const victimFile = path.join(victimDirectory, 'spnCert.pem');
            fs.writeFileSync(victimFile, 'victim');
            fs.unlinkSync(certificatePath);
            fs.rmdirSync(directoryPath);
            fs.symlinkSync(victimDirectory, directoryPath, 'junction');

            dispose();
            check(fs.readFileSync(victimFile, 'utf8') === 'victim', 'cleanup followed the directory link');
            check(fs.lstatSync(directoryPath).isSymbolicLink(), 'directory link removed');
        }
        // 'exit' scenario: leave the directories for the process exit handler.
    }

    console.log('ENDPOINT_CERTIFICATE_TEST_PASSED');
}

run().catch((error) => {
    console.log(`ENDPOINT_CERTIFICATE_TEST_FAILED: ${error && error.message || error}`);
    process.exitCode = 1;
});
