import { runDockerCommandSanitizationTests } from './dockerOutputSanitizationTests';
import { runAcrRegistryHostValidationTests } from './acrRegistryHostValidationTests';
import { runAcrProviderHostValidationTests } from './acrProviderHostValidationTests';
import { runAcrAuthenticationCompatibilityTests } from './acrAuthenticationCompatibilityTests';

describe('docker-common suite', () => {
    describe('Docker command output sanitization', runDockerCommandSanitizationTests);
    describe('ACR registry host validation', runAcrRegistryHostValidationTests);
    describe('ACR provider host validation', runAcrProviderHostValidationTests);
    describe('ACR authentication compatibility', runAcrAuthenticationCompatibilityTests);
});
