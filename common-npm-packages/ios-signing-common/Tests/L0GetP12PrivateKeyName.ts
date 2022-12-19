import * as mockery from "mockery";
import * as assert from "assert";

import { setToolProxy } from "./utils"

const tl = require('azure-pipelines-task-lib/mock-task');
const tlClone = Object.assign({}, tl);
tlClone.tool = setToolProxy(tlClone.tool);

const tmAnswers = {
    'checkPath': {
        'openssl': true,
        'grep': true
    },
    'which': {
        'openssl': 'openssl',
        'grep': 'grep'
    },
    'exec': {},
    'exist': {}
}

const stdOuts = [
    { p12CertPath: 'some1/path1', p12Pwd: 'somepassword', frendlyName: 'testName1', addOutput: true },
    { p12CertPath: 'some2/path2', p12Pwd: 'somepwd', frendlyName: 'testName2', addOutput: true },
    { p12CertPath: 'some3/path3', p12Pwd: 'somepass', frendlyName: 'testName3', addOutput: false },
];

const createOpenSSlCommand = (p12CertPath, p12Pwd, frendlyName, addOutput) => {
    return {
        command: `${tmAnswers['which']['openssl']} pkcs12 -in ${p12CertPath} -nocerts -passin pass:${p12Pwd} -passout pass:${p12Pwd} | grep friendlyName`,
        output: addOutput && `friendlyName: ${frendlyName}`
    }
}

export function getP12PrivateKeyNameTest() {
    before(() => {
        mockery.disable();
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        } as mockery.MockeryEnableArgs);
    });

    after(() => {
        mockery.deregisterAll();
        mockery.disable();
    });

    beforeEach(() => {
        mockery.resetCache();
    });

    afterEach(() => {
        mockery.deregisterMock('azure-pipelines-task-lib/task');
    });

    for (let i = 0; i < stdOuts.length; i++) {
        const { p12CertPath, p12Pwd, frendlyName, addOutput } = stdOuts[i];
        const { command, output } = createOpenSSlCommand(p12CertPath, p12Pwd, frendlyName, addOutput);
        tmAnswers['exec'][command] = {
            stdout: output || null,
            code: 0
        }

        it(`Shoud return correct name by path: ${p12CertPath}`, (done: MochaDone) => {
            let taskOutput = '';
            tlClone.setAnswers(tmAnswers);
            tlClone.setStdStream({
                write: (msg) => taskOutput += msg
            });

            mockery.registerMock('azure-pipelines-task-lib/task', tlClone);
            let iosSigning = require("../ios-signing-common");
           
            iosSigning.getP12PrivateKeyName(p12CertPath, p12Pwd).
                then(resp => {
                    const resStr = `["pkcs12","-in","${p12CertPath}","-nocerts","-passin","pass:${p12Pwd}","-passout","pass:${p12Pwd}"]`;
                    assert.ok(taskOutput.indexOf(resStr) >= 0)
                    assert.equal(resp, frendlyName);
                    done();
                }).
                catch(err => {
                    if (!addOutput) {
                        assert.ok(err.message.indexOf('P12PrivateKeyNameNotFound') >= 0);
                        done();
                    } else {
                        done(err)
                    }
                });
        });
    }
}