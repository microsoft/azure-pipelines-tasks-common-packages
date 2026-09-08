import { runDockerCommandSanitizationTests } from './dockerOutputSanitizationTests';
import { runAcrRegistryHostValidationTests } from './acrRegistryHostValidationTests';
import { runAcrProviderHostValidationTests } from './acrProviderHostValidationTests';

describe('docker-common suite', () => {
    describe('Docker command output sanitization', runDockerCommandSanitizationTests);
    describe('ACR registry host validation', runAcrRegistryHostValidationTests);
    describe('ACR provider host validation', runAcrProviderHostValidationTests);
});
