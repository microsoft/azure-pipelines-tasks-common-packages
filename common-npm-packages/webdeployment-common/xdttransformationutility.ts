import tl = require('azure-pipelines-task-lib/task');
import * as fs from 'fs';
import path = require('path');
import { DOMParser } from '@xmldom/xmldom';
import { detectFileEncoding } from './fileencoding';

const xdtNamespace = 'http://schemas.microsoft.com/XML-Document-Transform';
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
    'SetTokenizedAttributeStorage',
    'SetTokenizedAttributes'
];
const builtInXdtLocatorTypes = [
    'Condition',
    'DefaultLocator',
    'Match',
    'XPath'
];

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

    validateXdtTransformFile(transformFile);

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

function validateXdtTransformFile(transformFile: string): void {
    const xmlContent = readTransformFile(transformFile);
    const transformDocument = parseTransformFile(transformFile, xmlContent);
    validateXdtNode(transformFile, transformDocument.documentElement);
}

function readTransformFile(transformFile: string): string {
    const buffer = fs.readFileSync(transformFile);
    const encoding = detectTransformFileEncoding(transformFile, buffer);
    return buffer.toString(encoding as BufferEncoding);
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
    if (isXdtNode(element, 'Import')) {
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

        const attributeName = getLocalName(attribute);
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

    throw new Error(tl.loc('XdtTransformationBlockedCustomType', transformFile, attributeName, typeName));
}

function getXdtTypeName(attributeValue: string): string {
    const argumentStartIndex = attributeValue.indexOf('(');
    const typeName = argumentStartIndex == -1 ? attributeValue : attributeValue.substr(0, argumentStartIndex);
    return typeName.trim();
}

function isXdtNode(node: Element | Attr, localName: string): boolean {
    return node.namespaceURI == xdtNamespace && getLocalName(node) == localName;
}

function getLocalName(node: Element | Attr): string {
    if (node.localName) {
        return node.localName;
    }

    const separatorIndex = node.nodeName.indexOf(':');
    return separatorIndex == -1 ? node.nodeName : node.nodeName.substr(separatorIndex + 1);
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