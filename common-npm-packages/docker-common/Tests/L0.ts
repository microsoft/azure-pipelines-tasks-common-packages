import { runDockerCommandSanitizationTests } from './dockerOutputSanitizationTests';
import { runContainerConnectionErrlineTests } from './containerConnectionErrlineTests';
import { runRealToolRunnerSanitizationTests } from './realToolRunnerSanitizationTests';
import { runAcrRegistryHostValidationTests } from './acrRegistryHostValidationTests';
import { runAcrProviderHostValidationTests } from './acrProviderHostValidationTests';
import { runAcrAuthenticationCompatibilityTests } from './acrAuthenticationCompatibilityTests';

describe('docker-common suite', () => {
    describe('Docker command output sanitization', runDockerCommandSanitizationTests);
    describe('ContainerConnection errline sanitization', runContainerConnectionErrlineTests);
    describe('Real ToolRunner output sanitization', runRealToolRunnerSanitizationTests);
    describe('ACR registry host validation', runAcrRegistryHostValidationTests);
    describe('ACR provider host validation', runAcrProviderHostValidationTests);
    describe('ACR authentication compatibility', runAcrAuthenticationCompatibilityTests);
});
