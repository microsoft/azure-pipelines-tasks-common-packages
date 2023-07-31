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

            const [result] = sanitizeScriptArgs(input, { argsSplitSymbols: '``' });

            assert.equal(result, input);
        })
    });

    ([
        "Param1 Param2",
        "Param1 \\| Out-File ./321",
        "'Param 1' 'Param 2'",
        "hello`\\;world",
    ] as string[]).forEach((input) => {
        it(`Should process '${input}' with no replacement. With \\`, () => {

            const [result] = sanitizeScriptArgs(input, { argsSplitSymbols: '\\\\', });

            assert.equal(result, input);
        })
    });

    ([
        ["1 ``; whoami", "``", "1 ``_#removed#_ whoami"],
        ["'1 ``; whoami'", "\\\\", "'1 ``_#removed#_ whoami'"], // we're ignoring quotes
        ["1 \\\\; whoami", "\\\\", "1 \\\\_#removed#_ whoami"],
        ["1 `; whoami", "\\\\", "1 `_#removed#_ whoami"] // if trying to use not matched escaping symbol
    ] as [string, '\\\\' | '``', string][]).forEach(([input, argsSplitSymbols, expected]) => {
        it(`Should process '${input}' and replace to '${expected}'`, () => {

            const [result] = sanitizeScriptArgs(input, { argsSplitSymbols });

            assert.equal(result, expected);
        })
    });

    ([
        ["${Param1}", "_#removed#__#removed#_Param1_#removed#_"], // we're not supporting env variables.
        ["1 | Out-File ./321", "1 _#removed#_ Out-File ./321"],
        ["12 && whoami", "12 _#removed#__#removed#_ whoami"],
        ["'12 && whoami'", "'12 _#removed#__#removed#_ whoami'"], // we're ignoring any quote types.
    ] as [string, string][]).forEach(([input, expected]) => {
        it(`'${input}' should be replaced to '${expected}'.`, () => {

            const [result] = sanitizeScriptArgs(input, { argsSplitSymbols: '``' });

            assert.equal(result, expected);
        })
    });

    it('Should use input reg exp', () => {
        const regx = /2/g;
        const input = "1 2";
        const expected = '1 _#removed#_';

        const [result] = sanitizeScriptArgs(input, { argsSplitSymbols: '``', saniziteRegExp: regx });

        assert.equal(result, expected);
    });

    it('Throws error if \'global\' flag not set', () => {
        const regx = /1/;

        assert.throws(() => sanitizeScriptArgs('', { argsSplitSymbols: '``', saniziteRegExp: regx }));
    })
}

export function runArgsSanitizerTelemetryTests() {
    it('Should return correct telemetry', () => {
        const regx = /[^2 ]/g;
        const input = "1 2 4 3 3 3;;_";
        const expected = {
            removedSymbols: {
                '1': 1,
                '3': 3,
                '4': 1,
                ';': 2,
                '_': 1,
            },
            removedSymbolsCount: 8
        };

        const [, result] = sanitizeScriptArgs(input, { argsSplitSymbols: '``', saniziteRegExp: regx });

        assert.deepStrictEqual(result, expected);
    })

    it('Returns null if nothing changed', () => {
        const regx = /2/g;
        const input = "1 3 5";
        const expected = null

        const [, result] = sanitizeScriptArgs(input, { argsSplitSymbols: '``', saniziteRegExp: regx });

        assert.deepStrictEqual(result, expected);
    })
}
