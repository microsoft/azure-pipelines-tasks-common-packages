import assert = require("assert");
import { sanitizeScriptArgs } from "../argsSanitizer"

export function runArgsSanitizerTests() {
    ([
        "Param1 Param2",
        "Param1 `| Out-File ./321",
        "'Param 1' 'Param 2'",
        "hello`;world",
    ] as string[]).forEach((input) => {
        it(`Should process '${input}' with no replacement.`, () => {

            const result = sanitizeScriptArgs(input, { argsSplitSymbols: '``', telemetryFeature: '', warningLocSymbol: '' });

            assert.equal(result, input);
        })
    });

    ([
        ["${Param1}", "_#removed#__#removed#_Param1_#removed#_"], // we're not supporting env variables.
        ["1 | Out-File ./321", "1 _#removed#_ Out-File ./321"],
        ["12 && whoami", "12 _#removed#__#removed#_ whoami"],
        ["'12 && whoami'", "'12 _#removed#__#removed#_ whoami'"], // we're ignoring any quote types.
    ] as [string, string][]).forEach(([input, expected]) => {
        it(`'${input}' should be replaced to '${expected}'.`, () => {

            const result = sanitizeScriptArgs(input, { argsSplitSymbols: '``', telemetryFeature: '', warningLocSymbol: '' });

            assert.equal(result, expected);
        })
    });

    it('Should use input reg exp', () => {
        const regx = /2/;
        const input = "1 2";
        const expected = '1 _#removed#_';

        const result = sanitizeScriptArgs(input, { argsSplitSymbols: '``', telemetryFeature: '', warningLocSymbol: '', saniziteRegExp: regx });

        assert.equal(result, expected);
    });
}
