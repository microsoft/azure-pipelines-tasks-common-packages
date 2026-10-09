import * as tl from 'azure-pipelines-task-lib';
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ltx from 'ltx';
import * as sinon from 'sinon';

import { applyXdtTransformation } from "../xdttransformationutility";
import { detectFileEncoding } from "../fileencoding";
import { WebDeploymentCompatibilityFixEnabled } from "../featureFlags";


export function runL1XdtTransformTests(this: Mocha.Suite) {
    [undefined, 'true'].forEach(featureValue => {
        describe(featureValue === undefined ? 'Hardened XDT enabled by default' : 'Hardened XDT explicitly enabled', function() {
            runXdtTransformTests.call(this, featureValue);
        });
    });
    describe('Hardened XDT explicitly disabled', runDisabledXdtTransformTests);
}

function runDisabledXdtTransformTests(this: Mocha.Suite) {
    const flagEnvironmentVariable = 'DISTRIBUTEDTASK_TASKS_' + WebDeploymentCompatibilityFixEnabled.toUpperCase();
    const unsafeTransformFile = getFixture('Web.DisabledUnsafeTransform.config');
    let previousFeatureValue: string | undefined;
    let previousUnsafeOptOut: string | undefined;
    let sandbox: sinon.SinonSandbox;

    beforeEach(() => {
        previousFeatureValue = process.env[flagEnvironmentVariable];
        previousUnsafeOptOut = process.env['AZP_ALLOW_UNSAFE_XDT_TRANSFORMS'];
        sandbox = sinon.createSandbox();
        assert(!fs.existsSync(unsafeTransformFile), 'The disabled-transform fixture must be new');
        fs.writeFileSync(unsafeTransformFile,
            '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform">' +
            '<xdt:Import assembly="CustomTransform" namespace="CustomTransform" /></configuration>');
    });
    afterEach(() => {
        sandbox.restore();
        fs.unlinkSync(unsafeTransformFile);
        if (previousFeatureValue === undefined) {
            delete process.env[flagEnvironmentVariable];
        }
        else {
            process.env[flagEnvironmentVariable] = previousFeatureValue;
        }
        if (previousUnsafeOptOut === undefined) {
            delete process.env['AZP_ALLOW_UNSAFE_XDT_TRANSFORMS'];
        }
        else {
            process.env['AZP_ALLOW_UNSAFE_XDT_TRANSFORMS'] = previousUnsafeOptOut;
        }
    });

    ['false', 'FALSE'].forEach(value => {
        it('Rejects ' + value + ' without reading files or executing XDT, even with the removed unsafe opt-out', () => {
            process.env[flagEnvironmentVariable] = value;
            process.env['AZP_ALLOW_UNSAFE_XDT_TRANSFORMS'] = 'true';
            const sourceFile = getFixture('Web.config');
            const originalSource = fs.readFileSync(sourceFile);
            const read = sandbox.spy(fs, 'readFileSync');
            const open = sandbox.spy(fs, 'openSync');
            const write = sandbox.spy(fs, 'writeFileSync');
            const execute = sandbox.stub(tl, 'execSync').throws(new Error('XDT must not execute'));
            const telemetry = sandbox.spy(console, 'log');
            [getFixture('Web.Debug.config'), unsafeTransformFile,
                getFixture('Missing.Transform.config')].forEach(transformFile => {
                assert.throws(() => applyXdtTransformation(sourceFile, transformFile),
                    /DistributedTask.Tasks.WebDeploymentCompatibilityFixEnabled is false.*No unhardened transformation was run/i);
            });
            assert.strictEqual(read.callCount, 0, 'Disabled transformations must not read source or transform bytes');
            assert.strictEqual(open.callCount, 0, 'Disabled transformations must not open files');
            assert.strictEqual(write.callCount, 0, 'Disabled transformations must not change the source');
            assert.strictEqual(execute.callCount, 0, 'Disabled transformations must not execute ctt.exe');
            assert.deepStrictEqual(fs.readFileSync(sourceFile), originalSource, 'The source must remain byte-for-byte unchanged');
            assert.strictEqual(telemetry.getCalls().filter(call =>
                typeof call.args[0] === 'string' && call.args[0].indexOf('"reason":"featureDisabled"') !== -1).length, 3);
        });
    });

    function getFixture(file: string): string {
        return path.join(__dirname, 'L1XdtTransform', file);
    }
}

function runXdtTransformTests(this: Mocha.Suite, featureValue?: string) {
    this.timeout(parseInt(process.env.TASK_TEST_TIMEOUT) || 20000);
    const temporaryTransformFiles: string[] = [];
    const flagEnvironmentVariable = 'DISTRIBUTEDTASK_TASKS_WEBDEPLOYMENTCOMPATIBILITYFIXENABLED';
    let previousFlagValue: string;

    tl.setResourcePath(path.join(__dirname, '..', 'module.json'));

    beforeEach(done => {
        previousFlagValue = process.env[flagEnvironmentVariable];
        if (featureValue === undefined) {
            delete process.env[flagEnvironmentVariable];
        }
        else {
            process.env[flagEnvironmentVariable] = featureValue;
        }
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
            if (previousFlagValue === undefined) {
                delete process.env[flagEnvironmentVariable];
            }
            else {
                process.env[flagEnvironmentVariable] = previousFlagValue;
            }
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

    it('Ignores the legacy unsafe XDT transform opt-out', function(done: Mocha.Done) {
        const transformFile = writeTemporaryTransformFile('Web.LegacyOptOutImport.config',
            '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform">\r\n' +
            '  <xdt:Import path="CustomTransform.dll" namespace="CustomTransform" />\r\n' +
            '  <appSettings xdt:Transform="SetAttributes" />\r\n' +
            '</configuration>\r\n');

        tl.setVariable('AZP_ALLOW_UNSAFE_XDT_TRANSFORMS', 'true');
        try {
            assert.throws(
                () => applyXdtTransformation(getAbsolutePath('Web_test.config'), transformFile),
                /xdt:Import/,
                'The legacy opt-out must not bypass XDT security validation');
        }
        finally {
            tl.setVariable('AZP_ALLOW_UNSAFE_XDT_TRANSFORMS', '');
        }
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

    it('Rejects transform files that declare a non ASCII-transparent encoding, hiding a smuggled xdt:Import (MSRC 139444)', function(done: Mocha.Done) {
        // The reported bypass: an XDT transform file whose declared encoding this validator cannot
        // safely model can smuggle markup that only a matching decoder resolves. A UTF-7 declaration
        // turns "+ADw-...+AD4-" into "<xdt:Import .../>" for a UTF-7-aware decoder, while a decoder
        // that does not honor the declaration only ever sees inert ASCII text. ctt.exe's
        // XmlTransformation loads the transform document independently of the source document (see
        // the comment above asciiTransparentEncodings in xdttransformationutility.ts), so the
        // encoding that matters here is the one declared by the transform file itself.
        const transformFile = writeTemporaryTransformFile('Web.SmuggledImport.config',
            '<?xml version="1.0" encoding="utf-7"?>\r\n' +
            '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform">\r\n' +
            '  +ADw-xdt:Import path="CustomTransform.dll" namespace="CustomTransform" /+AD4-\r\n' +
            '  <appSettings xdt:Transform="SetAttributes" />\r\n' +
            '</configuration>\r\n');

        assert.throws(
            () => applyXdtTransformation(getAbsolutePath('Web_test.config'), transformFile),
            /utf-7/i,
            'Should reject a transform document that declares an encoding the validator cannot model');
        done();
    });

    it('Rejects other encodings that can synthesise ASCII markup (variant coverage)', function(done: Mocha.Done) {
        // EBCDIC maps 0x4C to '<', and the ISO-2022 / HZ families synthesise ASCII through escape
        // sequences. Each is a different route to the same validator/consumer differential.
        ['ibm037', 'cp500', 'iso-2022-jp', 'iso-2022-kr', 'hz-gb-2312', 'utf-32'].forEach(encoding => {
            const transformFile = writeTemporaryTransformFile('Web.Encoding.config',
                '<?xml version="1.0" encoding="' + encoding + '"?>\r\n' +
                '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform">\r\n' +
                '  <appSettings xdt:Transform="SetAttributes" />\r\n' +
                '</configuration>\r\n');

            assert.throws(
                () => applyXdtTransformation(getAbsolutePath('Web_test.config'), transformFile),
                new RegExp(encoding, 'i'),
                'Should reject the non ASCII-transparent encoding "' + encoding + '"');
        });
        done();
    });

    it('Allows ASCII-transparent encoding declarations', function(done: Mocha.Done) {
        if (tl.getPlatform() !== tl.Platform.Windows) {
            this.skip();
        }

        // These encodings map every XML delimiter to the same byte the validator saw, so no decoder
        // disagreement can manufacture markup. They must keep working for existing pipelines, so
        // assert that the transformation actually succeeds and produces the transformed value.
        const encodings: { name: string, write: (content: string) => Buffer }[] = [
            { name: 'utf-8', write: content => Buffer.from(content, 'utf8') },
            { name: 'UTF-8', write: content => Buffer.from(content, 'utf8') },
            { name: 'us-ascii', write: content => Buffer.from(content, 'ascii') },
            { name: 'iso-8859-1', write: content => Buffer.from(content, 'latin1') },
            { name: 'iso-ir-100', write: content => Buffer.from(content, 'latin1') },
            { name: 'csISOLatin1', write: content => Buffer.from(content, 'latin1') },
            { name: 'cp819', write: content => Buffer.from(content, 'latin1') },
            { name: 'IBM819', write: content => Buffer.from(content, 'latin1') },
            { name: 'windows-1252', write: content => Buffer.from(content, 'latin1') },
            { name: 'shift_jis', write: content => Buffer.from(content, 'ascii') },
            { name: 'utf-16', write: content => Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(content, 'utf16le')]) }
        ];

        encodings.forEach(encoding => {
            const latin1Aliases = ['iso-ir-100', 'csISOLatin1', 'cp819', 'IBM819'];
            const expectedValue = 'Transformed' + (latin1Aliases.indexOf(encoding.name) !== -1 ? '\u00E9' : '');
            const sourceFile = writeTemporaryBinaryFile('Web.AllowedEncodingSource.config', encoding.write(
                '<?xml version="1.0" encoding="' + encoding.name + '"?>\r\n' +
                '<configuration>\r\n' +
                '  <appSettings>\r\n' +
                '    <add key="Setting1" value="Original" />\r\n' +
                '  </appSettings>\r\n' +
                '</configuration>\r\n'));

            const transformFile = writeTemporaryBinaryFile('Web.AllowedEncodingTransform.config', encoding.write(
                '<?xml version="1.0" encoding="' + encoding.name + '"?>\r\n' +
                '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform">\r\n' +
                '  <appSettings>\r\n' +
                '    <add key="Setting1" value="' + expectedValue + '" xdt:Locator="Match(key)" xdt:Transform="SetAttributes(value)" />\r\n' +
                '  </appSettings>\r\n' +
                '</configuration>\r\n'));

            applyXdtTransformation(sourceFile, transformFile);

            const result = fs.readFileSync(sourceFile).toString(encoding.name.toLowerCase() === 'utf-16' ? 'utf16le' : 'latin1');
            assert(result.indexOf(expectedValue) != -1,
                'Encoding "' + encoding.name + '" must still apply the transformation, got: ' + result);
        });
        done();
    });

    ['iso-ir-100', 'csISOLatin1', 'cp819', 'ibm819'].forEach((alias, aliasIndex) => {
        const sourceEncodings: { name: string, declaration: string, bom: Buffer, encoding: BufferEncoding }[] = [
            { name: 'implicit UTF-8', declaration: '', bom: Buffer.alloc(0), encoding: 'utf8' },
            { name: 'declared UTF-8', declaration: '<?xml version="1.0" encoding="utf-8"?>', bom: Buffer.alloc(0), encoding: 'utf8' },
            { name: 'UTF-8 BOM', declaration: '', bom: Buffer.from([0xEF, 0xBB, 0xBF]), encoding: 'utf8' },
            { name: 'UTF-16 LE', declaration: '<?xml version="1.0" encoding="utf-16"?>', bom: Buffer.from([0xFF, 0xFE]), encoding: 'utf16le' }
        ];
        sourceEncodings.forEach((sourceEncoding, sourceIndex) => {
            it('Rejects non-ASCII ' + alias + ' transforms against ' + sourceEncoding.name + ' before changing files', function() {
                const fixture = aliasIndex + '-' + sourceIndex;
                const originalSource = Buffer.concat([sourceEncoding.bom, Buffer.from(sourceEncoding.declaration +
                    '<configuration><appSettings><add key="Setting1" value="Original \u00E9" /></appSettings></configuration>',
                    sourceEncoding.encoding)]);
                const sourceFile = writeTemporaryBinaryFile('Web.MixedSource' + fixture + '.config', originalSource);
                const transformFile = writeTemporaryBinaryFile('Web.MixedTransform' + fixture + '.config', Buffer.from(
                    '<?xml version="1.0" encoding="' + alias + '"?>' +
                    '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform">' +
                    '<appSettings><add key="Setting1" value="caf\u00E9" xdt:Locator="Match(key)" ' +
                    'xdt:Transform="SetAttributes(value)" /></appSettings></configuration>', 'latin1'));
                const originalDestination = Buffer.from('<configuration />');
                const destinationFile = writeTemporaryBinaryFile('Web.MixedDestination' + fixture + '.config',
                    originalDestination);
                const sandbox = sinon.createSandbox();
                try {
                    const execute = sandbox.stub(tl, 'execSync').throws(new Error('XDT must not execute'));
                    assert.throws(() => applyXdtTransformation(sourceFile, transformFile), /encodings are incompatible/i);
                    assert.throws(() => applyXdtTransformation(sourceFile, transformFile, destinationFile),
                        /encodings are incompatible/i);
                    assert.strictEqual(execute.callCount, 0);
                    assert.deepStrictEqual(fs.readFileSync(sourceFile), originalSource);
                    assert.deepStrictEqual(fs.readFileSync(destinationFile), originalDestination);
                }
                finally {
                    sandbox.restore();
                }
            });
        });
    });

    it('Preserves non-ASCII values across equivalent Latin-1 source and transform aliases (L1)', function() {
        if (tl.getPlatform() !== tl.Platform.Windows) {
            this.skip();
        }
        ['iso-ir-100', 'csISOLatin1', 'cp819', 'ibm819', 'iso-8859-1'].forEach((alias, index) => {
            const sourceFile = writeTemporaryBinaryFile('Web.EquivalentLatin1Source' + index + '.config', Buffer.from(
                '<?xml version="1.0" encoding="iso-8859-1"?>' +
                '<configuration><appSettings><add key="Setting1" value="Original" /></appSettings></configuration>', 'latin1'));
            const expectedValue = 'caf\u00E9 \u00A3 \u00F1';
            const transformFile = writeTemporaryBinaryFile('Web.EquivalentLatin1Transform' + index + '.config', Buffer.from(
                '<?xml version="1.0" encoding="' + alias + '"?>' +
                '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform">' +
                '<appSettings><add key="Setting1" value="' + expectedValue + '" xdt:Locator="Match(key)" ' +
                'xdt:Transform="SetAttributes(value)" /></appSettings></configuration>', 'latin1'));
            applyXdtTransformation(sourceFile, transformFile);
            assert(fs.readFileSync(sourceFile, 'latin1').indexOf(expectedValue) !== -1);
        });
    });

    it('Preserves ASCII-only Latin-1 transforms against UTF-8 sources (L1)', function() {
        if (tl.getPlatform() !== tl.Platform.Windows) {
            this.skip();
        }
        ['iso-ir-100', 'csISOLatin1', 'cp819', 'ibm819', 'iso-8859-1'].forEach((alias, index) => {
            const sourceFile = writeTemporaryTransformFile('Web.AsciiLatin1Source' + index + '.config',
                '<configuration><appSettings><add key="Setting1" value="Original" /></appSettings></configuration>');
            const transformFile = writeTemporaryTransformFile('Web.AsciiLatin1Transform' + index + '.config',
                '<?xml version="1.0" encoding="' + alias + '"?>' +
                '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform">' +
                '<appSettings><add key="Setting1" value="Transformed" xdt:Locator="Match(key)" ' +
                'xdt:Transform="SetAttributes(value)" /></appSettings></configuration>');
            applyXdtTransformation(sourceFile, transformFile);
            assert(fs.readFileSync(sourceFile, 'utf8').indexOf('Transformed') !== -1);
        });
    });

    it('Allows XML declarations beyond the former probe boundary (L1)', function(done: Mocha.Done) {
        if (tl.getPlatform() !== tl.Platform.Windows) {
            this.skip();
        }

        const encodings: { name: string, write: (content: string) => Buffer }[] = [
            { name: 'utf-8', write: content => Buffer.from(content, 'utf8') },
            { name: 'utf-8', write: content => Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(content, 'utf8')]) },
            { name: 'utf-16', write: content => Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(content, 'utf16le')]) }
        ];

        encodings.forEach((encoding, index) => {
            const sourceFile = writeTemporaryTransformFile('Web.LongDeclarationSource' + index + '.config',
                '<configuration><appSettings><add key="Setting1" value="Original" /></appSettings></configuration>');
            const transformFile = writeTemporaryBinaryFile('Web.LongDeclarationTransform' + index + '.config', encoding.write(
                '<?xml version="1.0"' + ' '.repeat(8192) + 'encoding="' + encoding.name + '"?>\r\n' +
                '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform">' +
                '<appSettings><add key="Setting1" value="Transformed' + index + '" ' +
                'xdt:Locator="Match(key)" xdt:Transform="SetAttributes(value)" /></appSettings></configuration>'));

            applyXdtTransformation(sourceFile, transformFile);
            assert(fs.readFileSync(sourceFile, 'utf8').indexOf('Transformed' + index) !== -1,
                'The complete declaration must be validated and the transform must execute');
        });
        done();
    });

    it('Validates encodings and imports after a long XML declaration', function(done: Mocha.Done) {
        const transformFile = writeTemporaryTransformFile('Web.LongBlockedEncoding.config',
            '<?xml version="1.0"' + ' '.repeat(8192) + 'encoding="utf-7"?>\r\n' +
            '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform" />');

        assert.throws(() => applyXdtTransformation(getAbsolutePath('Web_test.config'), transformFile), /utf-7/i);

        const utf16BlockedEncoding = writeTemporaryBinaryFile('Web.LongUtf16BlockedEncoding.config', Buffer.concat([
            Buffer.from([0xFF, 0xFE]),
            Buffer.from('<?xml version="1.0"' + ' '.repeat(8192) + 'encoding="utf-7"?>\r\n' +
                '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform" />', 'utf16le')
        ]));
        assert.throws(() => applyXdtTransformation(getAbsolutePath('Web_test.config'), utf16BlockedEncoding), /utf-7/i);

        const importFile = writeTemporaryTransformFile('Web.LongBlockedImport.config',
            '<?xml version="1.0"' + ' '.repeat(8192) + 'encoding="iso-ir-100"?>\r\n' +
            '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform">' +
            '<xdt:Import path="CustomTransform.dll" namespace="CustomTransform" /></configuration>');

        const read = sinon.spy(fs, 'readFileSync');
        try {
            assert.throws(() => applyXdtTransformation(getAbsolutePath('Web_test.config'), importFile), /xdt:Import/);
            assert.strictEqual(read.withArgs(importFile).callCount, 1,
                'Declaration validation and DOM validation must use the same read');
        }
        finally {
            read.restore();
        }

        const utf16Import = writeTemporaryBinaryFile('Web.LongUtf16BlockedImport.config', Buffer.concat([
            Buffer.from([0xFF, 0xFE]),
            Buffer.from('<?xml version="1.0"' + ' '.repeat(8192) + 'encoding="utf-16"?>\r\n' +
                '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform">' +
                '<xdt:Import path="CustomTransform.dll" namespace="CustomTransform" /></configuration>', 'utf16le')
        ]));
        assert.throws(() => applyXdtTransformation(getAbsolutePath('Web_test.config'), utf16Import), /xdt:Import/);
        done();
    });

    it('Fails closed when a transform file cannot be read', function(done: Mocha.Done) {
        const failure = Object.assign(new Error('Access denied'), { code: 'EACCES' });
        const read = sinon.stub(fs, 'readFileSync').throws(failure);
        try {
            assert.throws(() => applyXdtTransformation(getAbsolutePath('Web_test.config'), 'Unreadable.config'),
                error => error instanceof Error && error !== failure && error.message.indexOf('Access denied') !== -1);
        }
        finally {
            read.restore();
        }
        done();
    });

    it('Preserves the missing transform file error', function(done: Mocha.Done) {
        const failure = Object.assign(new Error('No such file'), { code: 'ENOENT' });
        const read = sinon.stub(fs, 'readFileSync').throws(failure);
        try {
            assert.throws(() => applyXdtTransformation(getAbsolutePath('Web_test.config'), 'Missing.config'),
                error => error === failure);
        }
        finally {
            read.restore();
        }
        done();
    });

    it('Rejects invalid feature-flag values before reading or executing the transform', function() {
        const transformFile = writeTemporaryTransformFile('Web.DefaultCompatibility.config',
            '<?xml version="1.0" encoding="iso-ir-100"?>' +
            '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform" />');

        const sandbox = sinon.createSandbox();
        try {
            const read = sandbox.spy(fs, 'readFileSync');
            const execute = sandbox.stub(tl, 'execSync').throws(new Error('XDT must not execute'));
            ['not-true', '1', ' true ', 'true\r\n', 'false\n'].forEach(value => {
                process.env[flagEnvironmentVariable] = value;
                assert.throws(() => applyXdtTransformation(getAbsolutePath('Web_test.config'), transformFile),
                    /value must be 'true' or 'false'/i);
            });
            assert.strictEqual(read.callCount, 0);
            assert.strictEqual(execute.callCount, 0);
        }
        finally {
            sandbox.restore();
        }
    });

    it('Retains encoding hardening for empty and case-insensitive enabled flag values', function() {
        const transformFile = writeTemporaryTransformFile('Web.EnabledSecurityFlag.config',
            '<?xml version="1.0" encoding="utf-7"?>' +
            '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform" />');
        ['', 'TRUE'].forEach(value => {
            process.env[flagEnvironmentVariable] = value;
            assert.throws(() => applyXdtTransformation(getAbsolutePath('Web_test.config'), transformFile), /utf-7/i);
        });
    });

    it('Reads the compatibility flag on each transformation rather than at module load', function() {
        if (tl.getPlatform() !== tl.Platform.Windows) {
            this.skip();
        }

        const sourceFile = writeTemporaryTransformFile('Web.RuntimeCompatibilitySource.config',
            '<configuration><appSettings><add key="Setting1" value="Original" /></appSettings></configuration>');
        const transformFile = writeTemporaryTransformFile('Web.RuntimeCompatibility.config',
            '<?xml version="1.0" encoding="iso-ir-100"?>' +
            '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform">' +
            '<appSettings><add key="Setting1" value="RuntimeFlag" ' +
            'xdt:Locator="Match(key)" xdt:Transform="SetAttributes(value)" /></appSettings></configuration>');
        process.env[flagEnvironmentVariable] = 'false';
        assert.throws(() => applyXdtTransformation(sourceFile, transformFile),
            /No unhardened transformation was run/i);
        [undefined, '', 'TRUE'].forEach(value => {
            if (value === undefined) {
                delete process.env[flagEnvironmentVariable];
            }
            else {
                process.env[flagEnvironmentVariable] = value;
            }
            fs.writeFileSync(sourceFile,
                '<configuration><appSettings><add key="Setting1" value="Original" /></appSettings></configuration>');
            applyXdtTransformation(sourceFile, transformFile);
            assert(fs.readFileSync(sourceFile, 'utf8').indexOf('RuntimeFlag') !== -1);
        });
        process.env[flagEnvironmentVariable] = 'false';
        assert.throws(() => applyXdtTransformation(sourceFile, transformFile),
            /No unhardened transformation was run/i);
    });

    it('Rejects a declared encoding that disagrees with the transform file bytes', function(done: Mocha.Done) {
        // A UTF-16 declaration over plain-ASCII, un-BOM'd transform bytes means ctt.exe and the
        // validator would read the transform at different byte alignments, so the validator cannot
        // model what ctt.exe sees.
        const transformFile = writeTemporaryTransformFile('Web.MismatchedTransform.config',
            '<?xml version="1.0" encoding="utf-16"?>\r\n' +
            '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform">\r\n' +
            '  <appSettings xdt:Transform="SetAttributes" />\r\n' +
            '</configuration>\r\n');

        assert.throws(
            () => applyXdtTransformation(getAbsolutePath('Web_test.config'), transformFile),
            /utf-16/i,
            'Should reject a transform declaration that disagrees with the transform file encoding');
        done();
    });

    it('Rejects an empty encoding declaration (fail closed)', function(done: Mocha.Done) {
        const transformFile = writeTemporaryTransformFile('Web.EmptyEncoding.config',
            '<?xml version="1.0" encoding=""?>\r\n' +
            '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform">\r\n' +
            '  <appSettings xdt:Transform="SetAttributes" />\r\n' +
            '</configuration>\r\n');

        assert.throws(
            () => applyXdtTransformation(getAbsolutePath('Web_test.config'), transformFile),
            /not supported by Azure Pipelines XML transformations/i,
            'Should fail closed on a present but empty encoding declaration');
        done();
    });

    it('Rejects an unterminated XML declaration (fail closed)', function(done: Mocha.Done) {
        const transformFile = writeTemporaryTransformFile('Web.UnterminatedDeclaration.config',
            '<?xml version="1.0" encoding="utf-8"' + ' '.repeat(8192) +
            '<configuration xmlns:xdt="http://schemas.microsoft.com/XML-Document-Transform" />\r\n');

        assert.throws(
            () => applyXdtTransformation(getAbsolutePath('Web_test.config'), transformFile),
            /XML declaration/i,
            'Should fail closed when the XML declaration cannot be read');
        done();
    });

    it('Multi-byte CJK code pages in the encoding allowlist are verified ASCII-transparent', function(done: Mocha.Done) {
        // The security guarantee of asciiTransparentEncodings depends on every multi-byte CJK entry
        // genuinely being unable to synthesise an XML delimiter from non-ASCII bytes. That claim is
        // verified empirically against .NET's own Encoding tables by
        // Tests/CjkEncodingVerification/Program.cs; this test asserts that the checked-in verification
        // result is still zero violations and still covers every CJK code page group referenced by
        // xdttransformationutility.ts, so a future edit that adds a new multi-byte encoding without
        // re-running that verification is caught here instead of silently weakening the allowlist.
        const verificationResultsPath = path.join(__dirname, 'CjkEncodingVerification', 'verified-results.json');
        const verification = JSON.parse(fs.readFileSync(verificationResultsPath, 'utf8'));

        // Every multi-byte CJK encoding group accepted by asciiTransparentEncodings in
        // xdttransformationutility.ts. Keep this list in sync with that allowlist.
        const expectedEncodingGroups = ['shift_jis', 'gbk/gb18030', 'big5', 'euc-jp', 'euc-kr'];

        assert(Array.isArray(verification.results) && verification.results.length > 0,
            'verified-results.json must contain verification results');

        const verifiedGroups = verification.results.map((result: { encodingGroup: string }) => result.encodingGroup);
        expectedEncodingGroups.forEach(expectedGroup => {
            assert(verifiedGroups.indexOf(expectedGroup) !== -1,
                'Encoding group "' + expectedGroup + '" is allowed by the validator but has no recorded ' +
                'verification result. Run Tests/CjkEncodingVerification/Program.cs and update verified-results.json.');
        });

        verification.results.forEach((result: { encodingGroup: string, delimiterViolations: number }) => {
            assert.strictEqual(result.delimiterViolations, 0,
                'Encoding group "' + result.encodingGroup + '" recorded ' + result.delimiterViolations +
                ' delimiter violation(s) and must not be in the ASCII-transparent allowlist');
        });
        done();
    });

    function getAbsolutePath(file: string): string {
        return path.join(__dirname, 'L1XdtTransform', file);
    }

    function writeTemporaryFile(file: string, content: string): string {
        return writeTemporaryBinaryFile(file, Buffer.from(content, 'utf8'));
    }

    function writeTemporaryBinaryFile(file: string, content: Buffer): string {
        const filePath = getAbsolutePath(file);
        fs.writeFileSync(filePath, content);
        temporaryTransformFiles.push(filePath);
        return filePath;
    }

    function writeTemporaryTransformFile(file: string, content: string): string {
        return writeTemporaryFile(file, content);
    }

    function readXmlFile(path: string): ltx.Element {
        const buffer = fs.readFileSync(path);
        const encoding = detectFileEncoding(path, buffer)[0].toString();
        const xml = buffer.toString(encoding as BufferEncoding).replace( /(?<!\r)[\n]+/gm, "\r\n" );
        return ltx.parse(xml);
    }
}