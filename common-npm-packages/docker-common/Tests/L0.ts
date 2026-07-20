import { runDockerCommandSanitizationTests } from './dockerOutputSanitizationTests';

describe('docker-common suite', () => {
    describe('Docker command output sanitization', runDockerCommandSanitizationTests);
});
