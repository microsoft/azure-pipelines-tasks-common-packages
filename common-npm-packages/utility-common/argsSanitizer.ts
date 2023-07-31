type ArgsSplitSymbols = '``' | '\\\\';

export interface SanitizeScriptArgsOptions {
    argsSplitSymbols: ArgsSplitSymbols;
    saniziteRegExp?: RegExp;
    removedSymbolSign?: string
}

interface ArgsSanitizerTelemetry {
    removedSymbolsCount: number;
}

/**
 * This function sanitizes input arguments. We're sanitizing each symbol which we think is dangerous.
 * @param args original input arguments param
 * @returns sanitized input arguments
 */
export function sanitizeScriptArgs(args: string, options: SanitizeScriptArgsOptions): [string, ArgsSanitizerTelemetry] {
    const { argsSplitSymbols } = options;
    const removedSymbolSign = options.removedSymbolSign ?? '_#removed#_';

    // We're splitting by esc. symbol pairs, removing all suspicious characters and then join back
    const argsArr = args.split(argsSplitSymbols);
    // '?<!`' - checks if before a character is no escaping symbol. '^a-zA-Z0-9\`\\ _'"\-=/:' - checking if character is allowed. Instead replaces to _#removed#_
    const saniziteRegExp = options.saniziteRegExp ?? new RegExp(`(?<!${getEscapingSymbol(argsSplitSymbols)})([^a-zA-Z0-9\\\`\\\\ _'"\\\-=\\\/:\.])`, 'g');
    for (let i = 0; i < argsArr.length; i++) {
        argsArr[i] = argsArr[i].replace(saniziteRegExp, removedSymbolSign);
    }

    const resultArgs = argsArr.join(argsSplitSymbols);

    const telemetry: ArgsSanitizerTelemetry = {
        removedSymbolsCount: 0
    }

    if (resultArgs != args) {
        telemetry.removedSymbolsCount = (resultArgs.match(removedSymbolSign) || []).length;
    }

    return [resultArgs, telemetry];
}

function getEscapingSymbol(argsSplitSymbols: ArgsSplitSymbols): string {
    switch (argsSplitSymbols) {
        case '\\\\':
            return '\\\\';
        case '``':
            return '`';
        default:
            throw new Error('Unknown args splitting symbols.');
    }
}
