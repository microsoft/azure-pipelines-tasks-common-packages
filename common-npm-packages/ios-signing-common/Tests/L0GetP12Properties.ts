import * as mockery from "mockery";
import * as assert from "assert";
import { EOL } from 'os';

import { setToolProxy } from "./utils"

const tl = require('azure-pipelines-task-lib/mock-task');
const tlClone = Object.assign({}, tl);
tlClone.tool = setToolProxy(tlClone.tool);
tlClone.setStdStream({
    write: (msg) => null
});

const tmAnswers = {
    'checkPath': {
        'openssl': true
    },
    'which': {
        'openssl': 'openssl'
    },
    'exec': {},
    'exist': {}
}

const stdOuts = [
    { p12Path: 'some1/path1', p12Pwd: 'somepassword', fingerprint: 'BB:26:83:C6:AA:88:35:DE:36:94:F2:CF:37:0A:D4:60:BB:AE:87:0C', commonName: 'test common name', notBefore: 'Nov 14 03:37:42 2018 GMT', notAfter: 'Nov 14 03:37:42 2019 GMT', error: false },
    { p12Path: 'some2/path2', p12Pwd: 'smpwd', fingerprint: 'BB:26:83:C6:AA:88:35:DE:36:94:F5:CF:37:0A:D4:60:BB:AE:87:0C', commonName: 'another name', notBefore: 'Nov 15 03:37:42 2018 GMT', notAfter: 'Nov 15 03:37:42 2019 GMT', error: false },
    { p12Path: 'some3/path3', p12Pwd: 'somepwd', fingerprint: 'BB:26:83:C6:AA:88:35:DE:36:94:F2:CF:37:01:D4:60:BB:AE:87:0C', commonName: 'someotheronelinename', notBefore: 'Nov 16 03:37:42 2018 GMT', notAfter: 'Nov 16 03:37:42 2019 GMT', error: false },
    { p12Pwd: 'etst', error: true},
    { p12Pwd: '', error: true}
];

const createOpenSSlCommand = (p12Path, p12Pwd, fingerprint, commonName, notBefore, notAfter) => {
    return {
        command: `${tmAnswers['which']['openssl']} pkcs12 -in ${p12Path} -nokeys -passin pass:${p12Pwd} | ${tmAnswers['which']['openssl']} x509 -sha1 -noout -fingerprint -subject -dates -nameopt utf8,sep_semi_plus_space`,
        output: `SHA1 Fingerprint=${fingerprint}${EOL}subject=UID=E848ASUQZY; CN=${commonName}; OU=DJ8T2973U7; O=Chris Sidi; C=US${EOL}notBefore=${notBefore}${EOL}notAfter=${notAfter}`
    }
}

export function getP12PropertiesTest() {
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

    for ( let i = 0; i < stdOuts.length; i++) {
        const { p12Path, p12Pwd, fingerprint, commonName, notBefore, notAfter, error } = stdOuts[i];
        const { command, output } = createOpenSSlCommand(p12Path, p12Pwd, fingerprint, commonName, notBefore, notAfter);
        tmAnswers['exec'][command] = {
            stdout: output || null,
            code: 0
        }

        it(`Shoud return correct data: p12Path: ${p12Path} p12Pwd: ${p12Pwd}`, (done: MochaDone) => {
            tlClone.setAnswers(tmAnswers);
            mockery.registerMock('azure-pipelines-task-lib/task', tlClone);
            let iosSigning = require("../ios-signing-common");
            
            iosSigning.getP12Properties(p12Path, p12Pwd).
                then(resp => {
                    assert.deepStrictEqual(resp, {
                        fingerprint: fingerprint.replace(/:/g, '').trim(),
                        commonName: commonName,
                        notBefore: new Date(notBefore),
                        notAfter: new Date(notAfter),
                    });
                    done();
                }).
                catch(err => {
                    if (error) done();
                    else done(err);
                });
        });
    }
}