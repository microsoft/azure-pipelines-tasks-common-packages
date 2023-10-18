import * as tl from 'azure-pipelines-task-lib';
import { substituteXmlVariables } from '../xmlvariablesubstitutionutility';
import { detectFileEncoding } from "../fileencoding";
import * as  path from 'path';
import assert = require('assert');
import * as ltx from 'ltx';
import * as fs from 'fs';

export function runL1XmlVarSubTests() {

    this.timeout(60000);

    beforeEach(done => {
       tl.cp(getAbsolutePath('Web.config'), getAbsolutePath('Web_test.config'), '-f', false);
       tl.cp(getAbsolutePath('Web.Debug.config'), getAbsolutePath('Web_test.Debug.config'), '-f', false);
       tl.cp(getAbsolutePath('parameters.xml'), getAbsolutePath('parameters_test.xml'), '-f', false);

       done();
   });

   afterEach(done => {
       try {
           tl.rmRF(getAbsolutePath('parameters_test.xml'));
           tl.rmRF(getAbsolutePath('Web_test.Debug.config'));
           tl.rmRF(getAbsolutePath('Web_test.config'));
       }
       catch (error) {
           tl.debug(error);
       }
       finally {
           done();
       }
   });

    it("Should replace xml variables", done => {
        const tags = ["applicationSettings", "appSettings", "connectionStrings", "configSections"];
        const configFiles = [
            getAbsolutePath('Web_test.config'),
            getAbsolutePath('Web_test.Debug.config')
        ];
        const variableMap = {
            'conntype': 'new_connType',
            "MyDB": "TestDB",
            'webpages:Version': '1.1.7.3',
            'xdt:Transform': 'DelAttributes',
            'xdt:Locator': 'Match(tag)',
            'DefaultConnection': "Url=https://primary;Database=db1;ApiKey=11111111-1111-1111-1111-111111111111;Failover = {Url:'https://secondary', ApiKey:'11111111-1111-1111-1111-111111111111'}",
            'OtherDefaultConnection': 'connectionStringValue2',
            'ParameterConnection': 'New_Connection_String From xml var subs',
            'connectionString': 'replaced_value',
            'invariantName': 'System.Data.SqlServer',
            'blatvar': 'ApplicationSettingReplacedValue',
            'log_level': 'error,warning',
            'Email:ToOverride': ''
        };

        const parameterFilePath = getAbsolutePath('parameters_test.xml');
        for (const configFile of configFiles) {
            substituteXmlVariables(configFile, tags, variableMap, parameterFilePath);
        }

        let transformedFilePath = getAbsolutePath('Web_test.config');
        let expectedFilePath = getAbsolutePath('Web_Expected.config');
        assert(compareXmlFiles(transformedFilePath, expectedFilePath), 'Should have substituted variables in Web.config file');
        
        transformedFilePath = getAbsolutePath('Web_test.Debug.config');
        expectedFilePath = getAbsolutePath('Web_Expected.Debug.config');
        assert(compareXmlFiles(transformedFilePath, expectedFilePath), 'Should have substituted variables in Web.Debug.config file');

        var resultParamFile = ltx.parse(fs.readFileSync(getAbsolutePath('parameters_test.xml')));
        var expectParamFile = ltx.parse(fs.readFileSync(getAbsolutePath('parameters_Expected.xml')));
        assert(ltx.equal(resultParamFile, expectParamFile), 'Should have substituted variables in parameters.xml file');

        done();
    });

    function getAbsolutePath(file: string): string {
        return path.join(__dirname, 'L1XmlVarSub', file);
    }

    function compareXmlFiles(actualFilePath: string, expectedFilePath: string): boolean {
        let transformedFileAsBuffer = fs.readFileSync(actualFilePath);
        const expectedFileAsBuffer = fs.readFileSync(expectedFilePath);
        const transformedFileEncodeType = detectFileEncoding(actualFilePath, transformedFileAsBuffer)[0].toString();
        let transformedFileAsString = transformedFileAsBuffer.toString(transformedFileEncodeType);
        transformedFileAsString = transformedFileAsString.replace( /(?<!\r)[\n]+/gm, "\r\n" );
        transformedFileAsBuffer = Buffer.from(transformedFileAsString, transformedFileEncodeType);
        var resultFile = ltx.parse(transformedFileAsBuffer);
        var expectFile = ltx.parse(expectedFileAsBuffer);
        const result = ltx.equal(resultFile, expectFile);

        if (!result) {
            console.debug(transformedFileAsString);
        }

        return result;
    }
}

