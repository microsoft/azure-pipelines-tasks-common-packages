import * as tl from 'azure-pipelines-task-lib';
import { emitTelemetry } from './telemetry';

export interface SanitizeScriptArgsOptions {
    argsSplitSymbols: '``' | '\\\\';
    warningLocSymbol: string;
    telemetryFeature: string;
    saniziteRegExp?: RegExp;
}

/**
 * This function sanitizes input arguments. We're sanitizing each symbol which we think is dangerous.
 * @param args original input arguments param
 * @returns sanitized input arguments
 */
export function sanitizeScriptArgs(args: string, options: SanitizeScriptArgsOptions): string {
    const { argsSplitSymbols, warningLocSymbol, telemetryFeature, saniziteRegExp } = options;
    const removedSymbolSign = '_#removed#_';

    const featureFlags = {
        audit: tl.getBoolFeatureFlag('AZP_75787_ENABLE_NEW_LOGIC_LOG'),
        activate: tl.getBoolFeatureFlag('AZP_75787_ENABLE_NEW_LOGIC'),
        telemetry: tl.getBoolFeatureFlag('AZP_75787_ENABLE_COLLECT')
    };

    // We're splitting by esc. symbol pairs, removing all suspicious characters and then join back
    const argsArr = args.split(argsSplitSymbols);
    // '?<!`' - checks if before a character is no escaping symbol. '^a-zA-Z0-9\`\\ _'"\-=/:' - checking if character is allowed. Instead replaces to _#removed#_
    const regexp = saniziteRegExp ?? new RegExp(`(?<!${argsSplitSymbols})([^a-zA-Z0-9\\\`\\\\ _'"\\\-=\\\/:\.])`, 'g');
    for (let i = 0; i < argsArr.length; i++) {
        argsArr[i] = argsArr[i].replace(regexp, removedSymbolSign);
    }

    const resultArgs = argsArr.join(argsSplitSymbols);

    if (resultArgs.includes(removedSymbolSign)) {
        if (featureFlags.audit || featureFlags.activate) {
            tl.warning(tl.loc(warningLocSymbol, resultArgs));
        }

        if (telemetryFeature && featureFlags.telemetry) {
            const removedSymbolsCount = (resultArgs.match(removedSymbolSign) || []).length;
            emitTelemetry('TaskHub', telemetryFeature, { removedSymbolsCount })
        }
    }

    return resultArgs;
}
