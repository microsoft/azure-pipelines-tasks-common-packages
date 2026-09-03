import { runDockerCommandSanitizationTests } from './dockerOutputSanitizationTests';
import { runAcrRegistryHostValidationTests } from './acrRegistryHostValidationTests';

describe('docker-common suite', () => {
    describe('Docker command output sanitization', runDockerCommandSanitizationTests);
    describe('ACR registry host validation', runAcrRegistryHostValidationTests);
});
