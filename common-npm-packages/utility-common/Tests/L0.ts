import { runArgsSanitizerTelemetryTests, runArgsSanitizerTests } from './argsSanitizerTests';
import { runShellQuoteTests, runNeutralizeCommandSubstitutionTests } from './shellEscapingTests';

describe('codeanalysis-common suite', () => {
    describe('Args sanitizer tests', runArgsSanitizerTests);

    describe('Args sanitizer telemetry tests', runArgsSanitizerTelemetryTests);

    describe('shellQuote', runShellQuoteTests);

    describe('neutralizeCommandSubstitution', runNeutralizeCommandSubstitutionTests);
});
