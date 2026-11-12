import assert = require('assert');
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const TELEMETRY_PREFIX = '##vso[telemetry.publish area=TaskDeploymentMethod;feature=AzureRMEndpointCertificateCredentials]';

export function AzureRMEndpointCertificateTests(defaultTimeout = 20000) {
    let agentTempDirectory: string;

    beforeEach(() => {
        agentTempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'azarmrest-endpoint-test-'));
    });

    afterEach(() => {
        removeTree(agentTempDirectory);
    });

    // Removes links without following them so a failing link test cannot delete the link target.
    function removeTree(entryPath: string): void {
        const stats = fs.lstatSync(entryPath);
        if (stats.isSymbolicLink() || !stats.isDirectory()) {
            fs.unlinkSync(entryPath);
            return;
        }
        fs.readdirSync(entryPath).forEach((entry) => removeTree(path.join(entryPath, entry)));
        fs.rmdirSync(entryPath);
    }

    function runScenario(scenario: string): string[] {
        const output = execFileSync(process.execPath, [
            path.join(__dirname, 'azure-arm-endpoint-certificate-tests.js'), agentTempDirectory, scenario
        ], { encoding: 'utf8', timeout: defaultTimeout });
        assert(output.includes('ENDPOINT_CERTIFICATE_TEST_PASSED'), output);
        return output.split(/\r?\n/)
            .filter((line) => line.indexOf(TELEMETRY_PREFIX) === 0)
            .map((line) => line.substring(TELEMETRY_PREFIX.length));
    }

    function credentialDirectories(): string[] {
        return fs.readdirSync(agentTempDirectory).filter((entry) => entry.indexOf('.azarmrest-endpoint-') === 0);
    }

    it('writes the certificate to a unique isolated directory and removes it on dispose', function () {
        this.timeout(defaultTimeout);
        const telemetry = runScenario('isolated');
        assert.deepStrictEqual(telemetry, [
            '{"isolation":"enabled"}',
            '{"isolation":"enabled"}',
            '{"cleanup":"deleted","trigger":"dispose"}',
            '{"cleanup":"deleted","trigger":"dispose"}'
        ]);
        assert.deepStrictEqual(credentialDirectories(), []);
    });

    it('uses the legacy certificate path when isolation is disabled', function () {
        this.timeout(defaultTimeout);
        const telemetry = runScenario('legacy');
        assert.deepStrictEqual(telemetry, ['{"isolation":"disabled"}']);
        assert(!fs.existsSync(path.join(agentTempDirectory, 'spnCert.pem')));
        assert.deepStrictEqual(credentialDirectories(), []);
    });

    it('removes isolated directories when the process exits without dispose', function () {
        this.timeout(defaultTimeout);
        const telemetry = runScenario('exit');
        assert.deepStrictEqual(telemetry, [
            '{"isolation":"enabled"}',
            '{"isolation":"enabled"}',
            '{"cleanup":"deleted","trigger":"exit"}',
            '{"cleanup":"deleted","trigger":"exit"}'
        ]);
        assert.deepStrictEqual(credentialDirectories(), []);
    });

    it('does not follow a directory link during cleanup', function () {
        this.timeout(defaultTimeout);
        const telemetry = runScenario('link');
        assert.deepStrictEqual(telemetry, [
            '{"isolation":"enabled"}',
            '{"isolation":"enabled"}',
            '{"cleanup":"rejected","trigger":"dispose"}',
            '{"cleanup":"deleted","trigger":"dispose"}'
        ]);
    });
}
