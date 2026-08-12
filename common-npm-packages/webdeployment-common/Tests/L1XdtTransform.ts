import * as tl from 'azure-pipelines-task-lib';
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ltx from 'ltx';

import { applyXdtTransformation } from "../xdttransformationutility";
import { detectFileEncoding } from "../fileencoding";


export function runL1XdtTransformTests(this: Mocha.Suite) {

    this.timeout(parseInt(process.env.TASK_TEST_TIMEOUT) || 20000);
    const temporaryTransformFiles: string[] = [];

    tl.setResourcePath(path.join(__dirname, '..', 'module.json'));

    beforeEach(done => {
        tl.cp(getAbsolutePath('Web.config'), getAbsolutePath('Web_test.config'), '-f', false);
 
        done();
    });
 
    afterEach(done => {
        try {
            tl.rmRF(getAbsolutePath('Web_test.config'));
            temporaryTransformFiles.forEach(transformFile => tl.rmRF(transformFile));
            temporaryTransformFiles.length = 0;
        }
        catch (error) {
            tl.debug(error);
        }
        finally {
            done();
        }
    });

    it('Runs successfully with XML Transformation (L1)', function(done: Mocha.Done) {
        if (tl.getPlatform() !== tl.Platform.Windows) {
            this.skip();
        }

        applyXdtTransformation(getAbsolutePath('Web_test.config'), getAbsolutePath('Web.Debug.config'));

        const resultFile = readXmlFile(getAbsolutePath('Web_test.config'));
        const expectFile = readXmlFile(getAbsolutePath('Web_Expected.config'));
        assert(ltx.equal(resultFile, expectFile), 'Should Transform attributes on Web.config');
        done();

    });

    it('Rejects XDT imports that load assemblies by path', function(done: Mocha.Done) {
        const transformFile = writeTemporaryTransformFile('Web.BlockedImportPath.config',
            '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform">\r\n' +
            '  <xdt:Import path="CustomTransform.dll" namespace="CustomTransform" />\r\n' +
            '  <appSettings xdt:Transform="SetAttributes" />\r\n' +
            '</configuration>\r\n');

        assert.throws(
            () => applyXdtTransformation(getAbsolutePath('Web_test.config'), transformFile),
            /xdt:Import/,
            'Should reject transform files that import assemblies by path');
        done();
    });

    it('Rejects XDT imports that load assemblies by name', function(done: Mocha.Done) {
        const transformFile = writeTemporaryTransformFile('Web.BlockedImportAssembly.config',
            '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform">\r\n' +
            '  <xdt:Import assembly="CustomTransform" namespace="CustomTransform" />\r\n' +
            '  <appSettings xdt:Transform="SetAttributes" />\r\n' +
            '</configuration>\r\n');

        assert.throws(
            () => applyXdtTransformation(getAbsolutePath('Web_test.config'), transformFile),
            /xdt:Import/,
            'Should reject transform files that import assemblies by name');
        done();
    });

    it('Rejects XDT imports declared with alternate namespace prefixes', function(done: Mocha.Done) {
        const transformFile = writeTemporaryTransformFile('Web.BlockedImportAlias.config',
            '<configuration xmlns:customXdt="http://schemas.microsoft.com/XML-Document-Transform">\r\n' +
            '  <customXdt:Import path="CustomTransform.dll" namespace="CustomTransform" />\r\n' +
            '  <appSettings customXdt:Transform="SetAttributes" />\r\n' +
            '</configuration>\r\n');

        assert.throws(
            () => applyXdtTransformation(getAbsolutePath('Web_test.config'), transformFile),
            /xdt:Import/,
            'Should reject transform files that import assemblies with alternate namespace prefixes');
        done();
    });

    it('Rejects custom XDT transform types', function(done: Mocha.Done) {
        const transformFile = writeTemporaryTransformFile('Web.BlockedTransform.config',
            '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform">\r\n' +
            '  <appSettings xdt:Transform="Probe" />\r\n' +
            '</configuration>\r\n');

        assert.throws(
            () => applyXdtTransformation(getAbsolutePath('Web_test.config'), transformFile),
            /Probe/,
            'Should reject custom XDT transform types');
        done();
    });

    it('Rejects custom XDT locator types', function(done: Mocha.Done) {
        const transformFile = writeTemporaryTransformFile('Web.BlockedLocator.config',
            '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform">\r\n' +
            '  <appSettings>\r\n' +
            '    <add key="Custom" value="Custom" xdt:Locator="Probe(key)" xdt:Transform="SetAttributes" />\r\n' +
            '  </appSettings>\r\n' +
            '</configuration>\r\n');

        assert.throws(
            () => applyXdtTransformation(getAbsolutePath('Web_test.config'), transformFile),
            /Probe/,
            'Should reject custom XDT locator types');
        done();
    });

    it('Rejects XDT imports smuggled through a DTD entity (fail closed)', function(done: Mocha.Done) {
        const transformFile = writeTemporaryTransformFile('Web.BlockedDtdImport.config',
            '<!DOCTYPE configuration [<!ENTITY imp "<xdt:Import path=\'CustomTransform.dll\' namespace=\'CustomTransform\'/>">]>\r\n' +
            '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform">\r\n' +
            '  &imp;\r\n' +
            '  <appSettings xdt:Transform="SetAttributes" />\r\n' +
            '</configuration>\r\n');

        assert.throws(
            () => applyXdtTransformation(getAbsolutePath('Web_test.config'), transformFile),
            /parse XML transform file|xdt:Import/i,
            'Should fail closed on transform files that use a DTD/entity to hide xdt:Import');
        done();
    });

    it('Rejects xdt:Import declared in the default XDT namespace', function(done: Mocha.Done) {
        const transformFile = writeTemporaryTransformFile('Web.BlockedDefaultNsImport.config',
            '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform">\r\n' +
            '  <Import xmlns="http://schemas.microsoft.com/XML-Document-Transform" path="CustomTransform.dll" namespace="CustomTransform" />\r\n' +
            '</configuration>\r\n');

        assert.throws(
            () => applyXdtTransformation(getAbsolutePath('Web_test.config'), transformFile),
            /xdt:Import/,
            'Should reject xdt:Import declared via the default XDT namespace');
        done();
    });

    it('Allows built-in XDT transforms and locators that take arguments (L1)', function(done: Mocha.Done) {
        if (tl.getPlatform() !== tl.Platform.Windows) {
            this.skip();
        }

        const transformFile = writeTemporaryTransformFile('Web.AllowedBuiltins.config',
            '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform">\r\n' +
            '  <appSettings>\r\n' +
            '    <add key="Setting1" value="Updated" xdt:Locator="Match(key)" xdt:Transform="SetAttributes(value)" />\r\n' +
            '  </appSettings>\r\n' +
            '</configuration>\r\n');

        try {
            applyXdtTransformation(getAbsolutePath('Web_test.config'), transformFile);
        }
        catch (error) {
            assert(!/xdt:Import|unsupported xdt:/i.test(error.message),
                'Validation must not block built-in transform/locator types with arguments, got: ' + error.message);
        }
        done();
    });

    it('Restores legacy behavior when the AZP_ALLOW_UNSAFE_XDT_TRANSFORMS opt-out is set', function(done: Mocha.Done) {
        if (tl.getPlatform() !== tl.Platform.Windows) {
            this.skip();
        }

        const transformFile = writeTemporaryTransformFile('Web.OptOutImport.config',
            '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform">\r\n' +
            '  <xdt:Import path="CustomTransform.dll" namespace="CustomTransform" />\r\n' +
            '  <appSettings xdt:Transform="SetAttributes" />\r\n' +
            '</configuration>\r\n');

        tl.setVariable('AZP_ALLOW_UNSAFE_XDT_TRANSFORMS', 'true');
        try {
            applyXdtTransformation(getAbsolutePath('Web_test.config'), transformFile);
        }
        catch (error) {
            assert(!/xdt:Import|unsupported xdt:/i.test(error.message),
                'Opt-out must bypass XDT security validation, got: ' + error.message);
        }
        finally {
            tl.setVariable('AZP_ALLOW_UNSAFE_XDT_TRANSFORMS', '');
        }
        done();
    });

    it('Enforces validation when the opt-out variable is not exactly "true"', function(done: Mocha.Done) {
        const transformFile = writeTemporaryTransformFile('Web.OptOutDisabledImport.config',
            '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform">\r\n' +
            '  <xdt:Import path="CustomTransform.dll" namespace="CustomTransform" />\r\n' +
            '  <appSettings xdt:Transform="SetAttributes" />\r\n' +
            '</configuration>\r\n');

        try {
            ['false', '1', 'yes'].forEach(value => {
                tl.setVariable('AZP_ALLOW_UNSAFE_XDT_TRANSFORMS', value);
                assert.throws(
                    () => applyXdtTransformation(getAbsolutePath('Web_test.config'), transformFile),
                    /xdt:Import/,
                    'Opt-out value "' + value + '" must not bypass XDT security validation');
            });
        }
        finally {
            tl.setVariable('AZP_ALLOW_UNSAFE_XDT_TRANSFORMS', '');
        }
        done();
    });

    function getAbsolutePath(file: string): string {
        return path.join(__dirname, 'L1XdtTransform', file);
    }

    function writeTemporaryTransformFile(file: string, content: string): string {
        const transformFile = getAbsolutePath(file);
        fs.writeFileSync(transformFile, content);
        temporaryTransformFiles.push(transformFile);
        return transformFile;
    }

    function readXmlFile(path: string): ltx.Element {
        const buffer = fs.readFileSync(path);
        const encoding = detectFileEncoding(path, buffer)[0].toString();
        const xml = buffer.toString(encoding as BufferEncoding).replace( /(?<!\r)[\n]+/gm, "\r\n" );
        return ltx.parse(xml);
    }
}