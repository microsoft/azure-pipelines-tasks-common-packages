import tl = require('azure-pipelines-task-lib/task');
import * as fs from 'fs';
import path = require('path');
import { DOMParser } from '@xmldom/xmldom';
import { detectFileEncoding } from './fileencoding';

const xdtNamespace = 'http://schemas.microsoft.com/XML-Document-Transform';
// Built-in XDT transform/locator type names. Verified by reflecting the concrete (non-abstract)
// subclasses of Microsoft.Web.XmlTransform.Transform / .Locator in the bundled ctt.exe
// (Microsoft.Web.XmlTransform v1.6.0.51029). Any transform/locator type outside this set can only
// be resolved through xdt:Import, which is blocked. Regenerate this list if the bundled ctt changes.
const builtInXdtTransformTypes = [
    'Insert',
    'InsertAfter',
    'InsertBefore',
    'InsertIfMissing',
    'Remove',
    'RemoveAll',
    'RemoveAttributes',
    'Replace',
    'SetAttributes',
    'SetTokenizedAttributes'
];
const builtInXdtLocatorTypes = [
    'Condition',
    'DefaultLocator',
    'Match',
    'XPath'
];

// Number of leading bytes probed when looking for an XML declaration. The declaration must be the
// very first construct in a well-formed document, so a small window is always sufficient.
const xmlDeclarationProbeByteCount = 4096;

// UTF-16 aliases that .NET resolves to a UTF-16 encoding. Declaring one of these changes the byte
// alignment ctt.exe uses, so it must agree with the encoding this validator decoded the transform
// file with, otherwise the two see completely different documents. Declared before the allowlist
// below because buildAsciiTransparentEncodingSet folds these entries into it.
const utf16EncodingAliases = {
    'utf-16': true, 'utf16': true, 'utf-16le': true, 'utf16le': true,
    'unicode': true, 'ucs-2': true, 'ucs2': true, 'ucs-2le': true, 'iso-10646-ucs-2': true
};

// The bundled ctt.exe (Microsoft.Web.XmlTransform) loads the *source* document first and then reads
// the *transform* file using the encoding declared by that source document, while this validator
// decodes the transform file using BOM/byte-shape detection (detectFileEncoding). When those two
// decoders disagree, markup can be hidden from validation yet revealed to ctt.exe - for example an
// all-ASCII transform file whose bytes only decode to <xdt:Import .../> under a stateful encoding
// such as UTF-7 ("+ADw-" -> "<"), or under EBCDIC (byte 0x4C -> "<").
//
// The invariant enforced by validateXdtEncodingDeclaration removes that whole class of differential:
// every encoding declared by the source or the transform document must be ASCII-transparent, i.e.
// no XML delimiter can be either synthesised or swallowed by a decoder disagreement. Every XML
// delimiter ('<' 0x3C, '>' 0x3E, '&' 0x26, '"' 0x22, '\'' 0x27, '=' 0x3D, '/' 0x2F) is ASCII, so
// under an ASCII-transparent encoding no decoder disagreement can manufacture markup this validator
// did not already see and inspect.
//
// The multi-byte CJK code pages qualify because none of their trail-byte ranges can hold an XML
// delimiter (every delimiter is below 0x40, and GB18030's only sub-0x40 trail range is the digits
// 0x30-0x39) and no multi-byte sequence in them maps below U+0080. Note that their trail ranges DO
// cover ASCII letters and digits, so do not extend this list by assuming "no trail byte below 0x40".
//
// Deliberately excluded: utf-7 and the ISO-2022 / HZ-GB-2312 family (escape sequences synthesise
// ASCII characters), every EBCDIC code page (0x00-0x7F map to entirely different characters), and
// utf-32 (not modelled by detectFileEncoding). UTF-16 is alignment-sensitive rather than
// ASCII-transparent, so the UTF-16 aliases are additionally subject to the explicit decoder
// agreement check in validateUtf16DecoderAgreement. UTF-16 BE is excluded outright because
// detectFileEncoding always rejects it, so this validator can never model a UTF-16 BE transform.
const asciiTransparentEncodings = buildAsciiTransparentEncodingSet();

function buildAsciiTransparentEncodingSet(): { [encodingName: string]: boolean } {
    const encodingNames = [
        // ASCII
        'ascii', 'us-ascii', 'usascii', 'iso646-us', 'ansi_x3.4-1968', 'ansi_x3.4-1986', 'iso-ir-6',
        'cp367', 'ibm367',
        // Unicode
        'utf-8', 'utf8', 'unicode-1-1-utf-8', 'x-unicode-2-0-utf-8',
        // Single-byte OEM/DOS code pages
        'ibm437', 'cp437', 'ibm850', 'cp850', 'ibm852', 'cp852', 'ibm858', 'cp858', 'ibm860', 'cp860',
        'ibm861', 'cp861', 'ibm862', 'cp862', 'ibm863', 'cp863', 'ibm864', 'cp864', 'ibm865', 'cp865',
        'ibm866', 'cp866', 'ibm869', 'cp869',
        // Other single-byte code pages
        'latin1', 'latin-1', 'l1', 'koi8-r', 'koi8-u', 'koi8-ru', 'macintosh',
        'x-mac-roman', 'x-mac-cyrillic', 'x-mac-ce', 'x-mac-greek', 'x-mac-turkish', 'x-mac-icelandic',
        'tis-620', 'windows-874', 'cp874',
        // Multi-byte CJK code pages
        'shift_jis', 'shift-jis', 'sjis', 'x-sjis', 'ms_kanji', 'cp932', 'windows-31j',
        'euc-jp', 'x-euc-jp', 'euc-kr', 'ks_c_5601-1987', 'ks_c_5601-1989', 'ksc5601', 'ksc_5601',
        'korean', 'windows-949', 'cp949',
        'gb2312', 'gb_2312-80', 'chinese', 'csgb2312', 'euc-cn', 'cn-gb', 'gbk', 'gb18030',
        'windows-936', 'cp936',
        'big5', 'big5-hkscs', 'cn-big5', 'csbig5', 'x-x-big5', 'windows-950', 'cp950'
    ];

    for (let part = 1; part <= 16; part++) {
        encodingNames.push('iso-8859-' + part, 'iso8859-' + part, 'iso_8859-' + part);
    }

    for (let codePage = 1250; codePage <= 1258; codePage++) {
        encodingNames.push('windows-' + codePage, 'cp' + codePage, 'x-cp' + codePage);
    }

    const encodingSet: { [encodingName: string]: boolean } = {};
    encodingNames.forEach(encodingName => encodingSet[encodingName] = true);
    Object.keys(utf16EncodingAliases).forEach(encodingName => encodingSet[encodingName] = true);
    return encodingSet;
}

export function expandWildcardPattern(folderPath: string, wildcardPattern : string) {
    var matchingFiles = tl.findMatch(folderPath, wildcardPattern,   { followSymbolicLinks: false, allowBrokenSymbolicLinks: false, followSpecifiedSymbolicLink: false });
    var filesList = {};
    for (let i = 0; i < matchingFiles.length; i++) {
        matchingFiles[i] = matchingFiles[i].replace(/\//g, '\\');
        filesList[matchingFiles[i].toLowerCase()] = matchingFiles[i];
    }

    return filesList;
}

/**
* Applys XDT transform on Source file using the Transform file
*
* @param    sourceFile Source Xml File
* @param    tansformFile Transform Xml File
*
*/
export function applyXdtTransformation(sourceFile: string, transformFile: string, destinationFile?: string) {

    validateXdtTransformFile(sourceFile, transformFile);

    var cttPath = path.join(__dirname, "ctt", "ctt", "ctt.exe"); 
    var cttArgsArray= [
        "s:" + sourceFile,
        "t:" + transformFile,
        "d:" + (destinationFile ? destinationFile : sourceFile),
        "pw",
        "i",
        "verbose"
    ];
    
    tl.debug("Running command: " + cttPath + ' ' + cttArgsArray.join(' '));
    var cttExecutionResult = tl.execSync(cttPath, cttArgsArray);
    if(cttExecutionResult.stderr) {
        throw new Error(tl.loc("XdtTransformationErrorWhileTransforming", sourceFile, transformFile));
    }
}

// Tracks whether the opt-out bypass has already been reported, so a package with many .config
// transform files does not emit repeated identical warnings and telemetry during a single task run.
let unsafeXdtTransformBypassReported = false;

function validateXdtTransformFile(sourceFile: string, transformFile: string): void {
    if (isUnsafeXdtTransformAllowed()) {
        // Opt-out escape hatch: restores the pre-hardening behavior for pipeline authors who
        // legitimately depend on custom XDT transforms. Report the bypass (warning + telemetry)
        // once per task run to avoid noise when many .config files are transformed in a loop.
        if (!unsafeXdtTransformBypassReported) {
            tl.warning(tl.loc('XdtTransformationSecurityValidationDisabled', transformFile));
            publishXdtSecurityTelemetry('bypassed', 'optOut');
            unsafeXdtTransformBypassReported = true;
        }
        return;
    }

    // ctt.exe decodes the transform file using the encoding declared by the *source* document, so the
    // source declaration is part of this validator's attack surface even though only the transform
    // file is inspected for xdt:Import and custom transform/locator types.
    const sourceDeclaredEncoding = validateXdtEncodingDeclaration(sourceFile);
    const transformDeclaredEncoding = validateXdtEncodingDeclaration(transformFile);

    // Read the transform exactly once, so the bytes whose declaration was validated are provably the
    // bytes that get parsed and inspected below.
    const transformBuffer = fs.readFileSync(transformFile);
    const transformEncoding = detectTransformFileEncoding(transformFile, transformBuffer);

    validateUtf16DecoderAgreement(sourceFile, sourceDeclaredEncoding, transformFile, transformDeclaredEncoding, transformEncoding);

    const transformDocument = parseTransformFile(transformFile, transformBuffer.toString(transformEncoding as BufferEncoding));
    validateXdtNode(transformFile, transformDocument.documentElement);
}

// UTF-16 is alignment-sensitive: the same bytes yield entirely different characters depending on
// whether they are read one or two at a time. Unlike the ASCII-transparent encodings, allowing it
// therefore requires proving that ctt.exe and this validator agree, rather than proving that no
// disagreement can matter.
function validateUtf16DecoderAgreement(
    sourceFile: string,
    sourceDeclaredEncoding: string,
    transformFile: string,
    transformDeclaredEncoding: string,
    transformEncoding: string): void {

    const transformIsUtf16 = transformEncoding == 'utf-16le';

    if (sourceDeclaredEncoding && isUtf16EncodingAlias(sourceDeclaredEncoding) != transformIsUtf16) {
        blockEncodingMismatch(sourceFile, sourceDeclaredEncoding, transformEncoding);
    }

    if (transformDeclaredEncoding && isUtf16EncodingAlias(transformDeclaredEncoding) != transformIsUtf16) {
        blockEncodingMismatch(transformFile, transformDeclaredEncoding, transformEncoding);
    }
}

function blockEncodingMismatch(file: string, declaredEncoding: string, transformEncoding: string): void {
    publishXdtSecurityTelemetry('blocked', 'encodingMismatch');
    throw new Error(tl.loc('XdtTransformationEncodingMismatch', file, declaredEncoding, transformEncoding));
}

// Returns the encoding declared by the document, or '' when the document has no XML declaration.
// Throws when the declared encoding cannot be modelled, or cannot be read at all.
function validateXdtEncodingDeclaration(file: string): string {
    let buffer: Buffer;
    try {
        buffer = readFileHead(file, xmlDeclarationProbeByteCount);
    }
    catch (error) {
        if (error && error.code === 'ENOENT') {
            // A genuinely absent file is not a validation concern: ctt.exe reports it itself, and
            // failing here would change the error surfaced for pre-existing packaging mistakes.
            tl.debug('Unable to read the XML declaration of ' + file + ': ' + describeError(error));
            return '';
        }

        // Any other read failure (a sharing violation or a denied ACL, for example) must fail closed.
        // Skipping the check here would silently disable the encoding gate for a file that ctt.exe
        // goes on to read successfully.
        publishXdtSecurityTelemetry('blocked', 'unreadableFile');
        throw new Error(tl.loc('XdtTransformationUnreadableFile', file, describeError(error)));
    }

    const declaredEncoding = readXmlDeclarationEncoding(file, buffer);
    if (declaredEncoding === null) {
        return '';
    }

    if (!isAsciiTransparentEncoding(declaredEncoding)) {
        publishXdtSecurityTelemetry('blocked', 'unsupportedEncodingDeclaration');
        throw new Error(tl.loc('XdtTransformationUnsupportedEncodingDeclaration', file, declaredEncoding));
    }

    return declaredEncoding;
}

function readFileHead(file: string, byteCount: number): Buffer {
    const descriptor = fs.openSync(file, 'r');
    try {
        const buffer = Buffer.alloc(byteCount);
        const bytesRead = fs.readSync(descriptor, buffer, 0, byteCount, 0);
        return buffer.subarray(0, bytesRead);
    }
    finally {
        fs.closeSync(descriptor);
    }
}

// Returns the declared encoding, or null when the document has no XML declaration at all. An empty
// declared encoding is returned as '' rather than null so that it is treated as a present-but-
// unmodellable declaration and blocked, instead of being mistaken for an absent declaration.
function readXmlDeclarationEncoding(file: string, buffer: Buffer): string {
    const prolog = stripByteOrderMark(buffer);

    // The declaration itself is always pure ASCII. Probe a byte-per-character view, which covers
    // UTF-8 and every single-byte code page, and a view with NUL bytes removed, which covers both
    // UTF-16 LE and UTF-16 BE.
    const prologCandidates = [prolog.toString('latin1'), removeNulBytes(prolog).toString('latin1')];

    for (let index = 0; index < prologCandidates.length; index++) {
        const candidate = prologCandidates[index];
        if (!/^<\?xml\s/.test(candidate)) {
            continue;
        }

        const declarationEnd = candidate.indexOf('?>');
        if (declarationEnd == -1) {
            // Fail closed: the document claims an XML declaration that this validator cannot read,
            // so it cannot establish which encoding ctt.exe will use.
            publishXdtSecurityTelemetry('blocked', 'malformedXmlDeclaration');
            throw new Error(tl.loc('XdtTransformationMalformedXmlDeclaration', file));
        }

        const match = /\bencoding\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(candidate.substring(0, declarationEnd));
        if (!match) {
            // A declaration without an encoding pseudo-attribute leaves ctt.exe on BOM detection,
            // which matches what detectFileEncoding does here.
            return null;
        }

        return (match[1] !== undefined ? match[1] : match[2]).trim();
    }

    return null;
}

function isAsciiTransparentEncoding(declaredEncoding: string): boolean {
    return asciiTransparentEncodings[declaredEncoding.trim().toLowerCase()] === true;
}

function isUtf16EncodingAlias(declaredEncoding: string): boolean {
    return utf16EncodingAliases[declaredEncoding.trim().toLowerCase()] === true;
}

function stripByteOrderMark(buffer: Buffer): Buffer {
    if (buffer.length >= 3 && buffer[0] == 0xEF && buffer[1] == 0xBB && buffer[2] == 0xBF) {
        return buffer.subarray(3);
    }

    if (buffer.length >= 2 && ((buffer[0] == 0xFF && buffer[1] == 0xFE) || (buffer[0] == 0xFE && buffer[1] == 0xFF))) {
        return buffer.subarray(2);
    }

    return buffer;
}

function removeNulBytes(buffer: Buffer): Buffer {
    const bytes: number[] = [];
    for (let index = 0; index < buffer.length; index++) {
        if (buffer[index] != 0) {
            bytes.push(buffer[index]);
        }
    }

    return Buffer.from(bytes);
}

function describeError(error: any): string {
    return error && error.message ? error.message : String(error);
}

function isUnsafeXdtTransformAllowed(): boolean {
    const value = tl.getVariable('AZP_ALLOW_UNSAFE_XDT_TRANSFORMS');
    if (!value) {
        return false;
    }

    return value.trim().toLowerCase() === 'true';
}

function publishXdtSecurityTelemetry(result: string, reason: string): void {
    try {
        const payload = JSON.stringify({ result: result, reason: reason });
        console.log('##vso[telemetry.publish area=TaskHub;feature=XdtTransformationSecurity]' + payload);
    }
    catch (error) {
        tl.debug('Unable to publish XDT transformation security telemetry: ' + (error && error.message ? error.message : error));
    }
}

function detectTransformFileEncoding(transformFile: string, buffer: Buffer): string {
    try {
        // Reuse the shared encoding detection so the XDT transform path stays consistent
        // with the XML/JSON variable-substitution paths and there is a single source of truth.
        // detectFileEncoding returns utf-8 / utf-16le and throws for unsupported encodings.
        return detectFileEncoding(transformFile, buffer)[0].toString();
    }
    catch (error) {
        tl.debug('Unable to detect encoding of XDT transform file ' + transformFile + ': ' + (error && error.message ? error.message : error));
        publishXdtSecurityTelemetry('blocked', 'unsupportedEncoding');
        throw new Error(tl.loc('XdtTransformationUnsupportedEncoding', transformFile));
    }
}

function parseTransformFile(transformFile: string, xmlContent: string): Document {
    try {
        return new DOMParser({
            errorHandler: {
                warning: function(message) {
                    tl.debug(message);
                },
                error: function(message) {
                    throw new Error(message);
                },
                fatalError: function(message) {
                    throw new Error(message);
                }
            }
        }).parseFromString(xmlContent, 'text/xml');
    }
    catch (error) {
        publishXdtSecurityTelemetry('blocked', 'invalidXml');
        throw new Error(tl.loc('XdtTransformationInvalidXml', transformFile, error.message || error));
    }
}

function validateXdtNode(transformFile: string, node: Node): void {
    if (!node) {
        return;
    }

    if (node.nodeType == 1) {
        const element = node as Element;
        validateXdtElement(transformFile, element);
        validateXdtAttributes(transformFile, element);
    }

    if (!node.childNodes) {
        return;
    }

    for (let index = 0; index < node.childNodes.length; index++) {
        validateXdtNode(transformFile, node.childNodes.item(index));
    }
}

function validateXdtElement(transformFile: string, element: Element): void {
    if (element.namespaceURI == xdtNamespace && !element.localName) {
        publishXdtSecurityTelemetry('blocked', 'invalidXdtNamespaceNode');
        throw new Error(tl.loc('XdtTransformationInvalidXdtNamespaceNode', transformFile, element.nodeName));
    }

    if (isXdtNode(element, 'Import')) {
        publishXdtSecurityTelemetry('blocked', 'import');
        throw new Error(tl.loc('XdtTransformationBlockedImport', transformFile));
    }
}

function validateXdtAttributes(transformFile: string, element: Element): void {
    if (!element.attributes) {
        return;
    }

    for (let index = 0; index < element.attributes.length; index++) {
        const attribute = element.attributes.item(index);
        if (!attribute || attribute.namespaceURI != xdtNamespace) {
            continue;
        }

        if (!attribute.localName) {
            publishXdtSecurityTelemetry('blocked', 'invalidXdtNamespaceAttribute');
            throw new Error(tl.loc('XdtTransformationInvalidXdtNamespaceNode', transformFile, attribute.nodeName));
        }

        const attributeName = attribute.localName;
        if (attributeName == 'Transform') {
            validateBuiltInXdtType(transformFile, attributeName, attribute.value, builtInXdtTransformTypes);
        }
        else if (attributeName == 'Locator') {
            validateBuiltInXdtType(transformFile, attributeName, attribute.value, builtInXdtLocatorTypes);
        }
    }
}

function validateBuiltInXdtType(transformFile: string, attributeName: string, attributeValue: string, builtInTypes: string[]): void {
    const typeName = getXdtTypeName(attributeValue);
    if (!typeName || builtInTypes.indexOf(typeName) != -1) {
        return;
    }

    publishXdtSecurityTelemetry('blocked', attributeName == 'Transform' ? 'customTransform' : 'customLocator');
    throw new Error(tl.loc('XdtTransformationBlockedCustomType', transformFile, attributeName, typeName));
}

function getXdtTypeName(attributeValue: string): string {
    const argumentStartIndex = attributeValue.indexOf('(');
    const typeName = argumentStartIndex == -1 ? attributeValue : attributeValue.substr(0, argumentStartIndex);
    return typeName.trim();
}

function isXdtNode(node: Element | Attr, localName: string): boolean {
    return node.namespaceURI == xdtNamespace && node.localName == localName;
}

/**
* Performs XDT transformations on *.config using ctt.exe
*
* @param    sourcePattern  The source wildcard pattern on which the transforms need to be applied
* @param    transformConfigs  The array of transform config names, ex : ["Release.config", "EnvName.config"]
* 
*/
export function basicXdtTransformation(rootFolder, transformConfigs): boolean {
    var sourceXmlFiles = expandWildcardPattern(rootFolder, '**/*.config');
    var isTransformationApplied = false;
    Object.keys(sourceXmlFiles).forEach( function(sourceXmlFile) {
        sourceXmlFile = sourceXmlFiles[sourceXmlFile];
        var sourceBasename = path.win32.basename(sourceXmlFile.replace(/\.config/ig,'\.config'), ".config");    
        transformConfigs.forEach( function(transformConfig) {
            var transformXmlFile = path.join(path.dirname(sourceXmlFile), sourceBasename + "." + transformConfig);
            if(sourceXmlFiles[transformXmlFile.toLowerCase()]) {
                tl.debug('Applying XDT Transformation : ' + transformXmlFile + ' -> ' + sourceXmlFile);
                applyXdtTransformation(sourceXmlFile, transformXmlFile);
                isTransformationApplied = true;
            }
        });
    });
    if(!isTransformationApplied) {
        tl.warning(tl.loc('FailedToApplyTransformation'));
        tl.warning(tl.loc('FailedToApplyTransformationReason1'));
        tl.warning(tl.loc('FailedToApplyTransformationReason2'));
    }

    return isTransformationApplied;
}


/**
* Performs XDT transformations using ctt.exe
* 
*/
export function specialXdtTransformation(rootFolder, transformConfig, sourceConfig, destinationConfig?: string): boolean {
    var sourceXmlFiles = expandWildcardPattern(rootFolder, sourceConfig);
    var isTransformationApplied = false;

    for(var sourceXmlFile in sourceXmlFiles) {
        sourceXmlFile = sourceXmlFiles[sourceXmlFile];        
        var sourceBasename = "", transformXmlFiles = {};

        if(sourceConfig.indexOf("*") != -1){
            var sourceConfigSuffix = sourceConfig.substr(sourceConfig.lastIndexOf("*") + 1);
            if(sourceConfigSuffix.indexOf("\\") != -1) {
                sourceConfigSuffix = sourceConfigSuffix.substr(sourceConfigSuffix.lastIndexOf("\\") + 1);
            }
            sourceBasename = path.win32.basename(sourceXmlFile.replace(/\.config/ig,'\.config'), sourceConfigSuffix);
            if(JSON.stringify(sourceBasename) == JSON.stringify(sourceConfigSuffix)) {
                sourceBasename = "";
            }
        }

        if(transformConfig.indexOf("*") != -1){
            if(sourceBasename) {
                var transformConfigSuffix = transformConfig.substr(transformConfig.lastIndexOf("*") + 1);
                if(transformConfigSuffix.indexOf("\\") != -1) {
                    transformConfigSuffix = transformConfigSuffix.substr(transformConfigSuffix.lastIndexOf("\\") + 1);
                }
                var transformXmlFile = path.join(path.dirname(sourceXmlFile), sourceBasename + transformConfigSuffix);
                transformXmlFiles[transformXmlFile.toLowerCase()] = transformXmlFile;
            }
            else { 
                var transformXmlFiles = expandWildcardPattern(rootFolder, transformConfig);
            }
        }
        else {
            transformXmlFile = path.join(rootFolder, transformConfig);
            transformXmlFiles[transformXmlFile.toLowerCase()] = transformXmlFile;
        }

        var destinationXmlFile = "";
        if(destinationConfig){
            if(destinationConfig.indexOf("*") != -1){
                var destinationConfigSuffix = destinationConfig.substr(destinationConfig.lastIndexOf("*") + 1);
                destinationXmlFile = path.join(path.dirname(sourceXmlFile), sourceBasename + destinationConfigSuffix);
            }
            else {
                destinationXmlFile = path.join(rootFolder, destinationConfig);
            }    
        }
        
        for(var transformXmlFile in transformXmlFiles) {                
            if(sourceXmlFiles[transformXmlFile.toLowerCase()] || tl.exist(transformXmlFile)) {
                console.log(tl.loc('ApplyingXDTtransformation' , transformXmlFile , sourceXmlFile));
                applyXdtTransformation(sourceXmlFile, transformXmlFile, destinationXmlFile);
                isTransformationApplied = true;
            }
        }
    }

    return isTransformationApplied;
}