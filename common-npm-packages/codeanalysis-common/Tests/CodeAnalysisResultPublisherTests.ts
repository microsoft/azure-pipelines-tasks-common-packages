import * as assert from 'assert';
import * as path from 'path';
import * as rewire from 'rewire';
import * as sinon from 'sinon';
import * as tl from 'azure-pipelines-task-lib/task';

import { FileSystemInteractions } from '../Common/FileSystemInteractions';

export function CodeAnalysisResultPublisherTests() {
    const sandbox = sinon.createSandbox();
    const codeAnalysisResultPublisherRewired = rewire('../Common/CodeAnalysisResultPublisher');
    const codeAnalysisResultPublisherClass = codeAnalysisResultPublisherRewired.__get__('CodeAnalysisResultPublisher');
    const codeAnalysisResultPublisherInstance = new codeAnalysisResultPublisherClass([], 'staging/dir');
    
    describe('function \'uploadArtifacts\'', () => {
        let analysisResultsStub, createDirectoryStub, copyFileStub;
        
        before(() => {
            sandbox.stub(tl, 'debug');
            sandbox.stub(tl, 'loc');
            sandbox.stub(tl, 'command');
            analysisResultsStub = sandbox.stub(codeAnalysisResultPublisherInstance, 'analysisResults');
            sandbox.stub(path, 'join');
            sandbox.stub(path, 'extname');
            sandbox.stub(path, 'basename');
            createDirectoryStub = sandbox.stub(FileSystemInteractions, 'createDirectory');
            copyFileStub = sandbox.stub(FileSystemInteractions, 'copyFile');
        });
        
        after(() => {
            sandbox.restore();
        });
        
        afterEach(() => {
            analysisResultsStub.reset();
            createDirectoryStub.reset();
            copyFileStub.reset();
        });
        
        it('should return undefined if there are no analysis results', () => {
            analysisResultsStub.value([]);
            
            const actual = codeAnalysisResultPublisherInstance.uploadArtifacts('prefix');
            assert.strictEqual(actual, undefined);
        });
        
        it('should return undefined if there are no analysis results with files', () => {
            analysisResultsStub.value([
                {
                    affectedFileCount: 2,
                    moduleName: 'module-1',
                    originatingTool: null,
                    resultFiles: [],
                    violationCount: 2
                },
                {
                    affectedFileCount: 2,
                    moduleName: 'module-2',
                    originatingTool: null,
                    resultFiles: null,
                    violationCount: 2
                }
            ]);
            
            const actual = codeAnalysisResultPublisherInstance.uploadArtifacts('prefix');
            assert.strictEqual(actual, undefined);
        });
        
        it('should return 2', () => {
            analysisResultsStub.value([
                {
                    affectedFileCount: 2,
                    moduleName: 'module-1',
                    originatingTool: {
                        toolName: 'some-tool-name'
                    },
                    resultFiles: [],
                    violationCount: 2
                },
                {
                    affectedFileCount: 2,
                    moduleName: 'module-2',
                    originatingTool: {
                        toolName: 'some-tool-name'
                    },
                    resultFiles: ['module-2/first/file', 'module-2/second/file'],
                    violationCount: 2
                },
                {
                    affectedFileCount: 2,
                    moduleName: 'module-3',
                    originatingTool: {
                        toolName: 'some-tool-name'
                    },
                    resultFiles: ['module-3/first/file', 'module-3/second/file'],
                    violationCount: 2
                }
            ]);

            const actual = codeAnalysisResultPublisherInstance.uploadArtifacts('prefix');
            assert.strictEqual(actual, 2);
            sinon.assert.callCount(createDirectoryStub, 3);
            sinon.assert.callCount(copyFileStub, 4);
        })
    });
    
    describe('function \'uploadBuildSummary\'', () => {
        let analysisResultsStub, uploadMdSummaryStub, createSummaryContentStub;
        
        before(() => {
            analysisResultsStub = sandbox.stub(codeAnalysisResultPublisherInstance, 'analysisResults');
            uploadMdSummaryStub = sandbox.stub(codeAnalysisResultPublisherInstance, 'uploadMdSummary');
            createSummaryContentStub = sandbox.stub(codeAnalysisResultPublisherInstance, 'createSummaryContent');
            sandbox.stub(tl, 'debug');
        });
        
        after(() => {
            sandbox.restore();
        });
        
        afterEach(() => {
            analysisResultsStub.reset();
            uploadMdSummaryStub.reset();
            createSummaryContentStub.reset();
        });
        
        it('should exit if there are no analysis results', () => {
            analysisResultsStub.value([]);
            
            codeAnalysisResultPublisherInstance.uploadBuildSummary(2);
            sinon.assert.notCalled(uploadMdSummaryStub);
            sinon.assert.notCalled(createSummaryContentStub);
        });
        
        it('should call functions \'uploadMdSummary\' and \'createSummaryContent\'', () => {
            analysisResultsStub.value([{
                affectedFileCount: 2,
                moduleName: 'module-1',
                originatingTool: null,
                resultFiles: [],
                violationCount: 2
            }]);
            
            codeAnalysisResultPublisherInstance.uploadBuildSummary(2);
            sinon.assert.calledOnce(uploadMdSummaryStub);
            sinon.assert.calledOnce(createSummaryContentStub);
        });
    });
    
    describe('function \'groupBy\'', () => {
        it('should return grouped structure', () => {
            const array = [
                {
                    id: 1,
                    name: 'first-group'
                },
                {
                    id: 2,
                    name: 'second-group'
                },
                {
                    id: 3,
                    name: 'first-group'
                },
                {
                    id: 4,
                    name: 'first-group'
                },
                {
                    id: 5,
                    name: 'first-group'
                },
                {
                    id: 6,
                    name: 'second-group'
                }
            ];
            
            const actual = codeAnalysisResultPublisherInstance.groupBy(array, (item) => item.name);
            assert.deepStrictEqual(actual, [
                [
                  {
                    id: 1,
                    name: 'first-group'
                  },
                  {
                    id: 3,
                    name: 'first-group'
                  },
                  {
                    id: 4,
                    name: 'first-group'
                  },
                  {
                    id: 5,
                    name: 'first-group'
                  }
                ],
                [
                  {
                    id: 2,
                    name: 'second-group'
                  },
                  {
                    id: 6,
                    name: 'second-group'
                  }
                ]
              ]);
        });
    });
    
    describe('function \'createSummaryContent\'', () => {
        let createSummaryLineStub;
        
        before(() => {
            sandbox.stub(codeAnalysisResultPublisherInstance, 'groupBy').returns([
                [
                    {
                        affectedFileCount: 2,
                        moduleName: 'module-1',
                        originatingTool: {
                            toolName: 'some-tool-name'
                        },
                        resultFiles: [],
                        violationCount: 2
                    },
                    {
                        affectedFileCount: 2,
                        moduleName: 'module-2',
                        originatingTool: {
                            toolName: 'some-tool-name'
                        },
                        resultFiles: [],
                        violationCount: 2
                    }
                ],
                [
                    {
                        affectedFileCount: 2,
                        moduleName: 'module-3',
                        originatingTool: {
                            toolName: 'another-tool-name'
                        },
                        resultFiles: [],
                        violationCount: 2
                    }
                ]
            ]);
            createSummaryLineStub = sandbox.stub(codeAnalysisResultPublisherInstance, 'createSummaryLine')
                .onCall(0).returns('some summary line')
                .returns(null);
            sandbox.stub(tl, 'debug');
        });
        
        after(() => {
            sandbox.restore();
        });
        
        afterEach(() => {
            createSummaryLineStub.resetHistory();
        });
        
        it('it should return correct summary content when no results uploaded', () => {
            const actual = codeAnalysisResultPublisherInstance.createSummaryContent(0);
            assert.strictEqual(actual, 'some summary line');
        });
        
        it('it should return correct summary content when some results uploaded', () => {
            const actual = codeAnalysisResultPublisherInstance.createSummaryContent(2);
            assert.strictEqual(actual, 'some summary line  \r\n' +
                '  \r\n' +
                'Code analysis results can be found in the \'Artifacts\' tab.');
        });
    });
    
    describe('function \'createSummaryLine\'', () => {
        let locStub;
        
        before(() => {
            locStub = sandbox.stub(tl, 'loc').returns('some line');
        });
        
        after(() => {
            sandbox.restore();
        });
        
        afterEach(() => {
            locStub.reset();
        });
        
        it('should return correct summary line if violation count > 1 and affected file count > 1', () => {
            codeAnalysisResultPublisherInstance.createSummaryLine([
                {
                    affectedFileCount: 3,
                    moduleName: 'module-1',
                    originatingTool: {
                        toolName: 'some-tool-name'
                    },
                    resultFiles: [],
                    violationCount: 1
                },
                {
                    affectedFileCount: 1,
                    moduleName: 'module-2',
                    originatingTool: {
                        toolName: 'some-tool-name'
                    },
                    resultFiles: [],
                    violationCount: 2
                }
            ]);
            sinon.assert.calledOnceWithExactly(
                locStub, 
                'codeAnalysisBuildSummaryLine_SomeViolationsSomeFiles', 
                'some-tool-name', 
                3, 
                4
            );
        });
        
        it('should return correct summary line if violation count > 1 and affected file count = 1', () => {
            codeAnalysisResultPublisherInstance.createSummaryLine([
                {
                    affectedFileCount: 0,
                    moduleName: 'module-1',
                    originatingTool: {
                        toolName: 'some-tool-name'
                    },
                    resultFiles: [],
                    violationCount: 0
                },
                {
                    affectedFileCount: 1,
                    moduleName: 'module-2',
                    originatingTool: {
                        toolName: 'some-tool-name'
                    },
                    resultFiles: [],
                    violationCount: 2
                }
            ]);
            sinon.assert.calledOnceWithExactly(
                locStub, 
                'codeAnalysisBuildSummaryLine_SomeViolationsOneFile', 
                'some-tool-name', 
                2
            );
        });
        
        it('should return correct summary line if violation count = 1 and affected file count = 1', () => {
            codeAnalysisResultPublisherInstance.createSummaryLine([
                {
                    affectedFileCount: 0,
                    moduleName: 'module-1',
                    originatingTool: {
                        toolName: 'some-tool-name'
                    },
                    resultFiles: [],
                    violationCount: 0
                },
                {
                    affectedFileCount: 1,
                    moduleName: 'module-2',
                    originatingTool: {
                        toolName: 'some-tool-name'
                    },
                    resultFiles: [],
                    violationCount: 1
                }
            ]);
            sinon.assert.calledOnceWithExactly(
                locStub, 
                'codeAnalysisBuildSummaryLine_OneViolationOneFile', 
                'some-tool-name'
            );
        });
        
        it('should return null if violation count = 0 and originating tool is not enabled', () => {
            const actual = codeAnalysisResultPublisherInstance.createSummaryLine([
                {
                    affectedFileCount: 0,
                    moduleName: 'module-1',
                    originatingTool: {
                        toolName: 'some-tool-name',
                        isEnabled: () => false
                    },
                    resultFiles: [],
                    violationCount: 0
                },
                {
                    affectedFileCount: 0,
                    moduleName: 'module-2',
                    originatingTool: {
                        toolName: 'some-tool-name'
                    },
                    resultFiles: [],
                    violationCount: 0
                }
            ]);
            assert.strictEqual(actual, null);
        });
        
        it('should return correct summary line if violation count = 0 and originating tool is enabled', () => {
            codeAnalysisResultPublisherInstance.createSummaryLine([
                {
                    affectedFileCount: 0,
                    moduleName: 'module-1',
                    originatingTool: {
                        toolName: 'some-tool-name',
                        isEnabled: () => true
                    },
                    resultFiles: [],
                    violationCount: 0
                },
                {
                    affectedFileCount: 0,
                    moduleName: 'module-2',
                    originatingTool: {
                        toolName: 'some-tool-name'
                    },
                    resultFiles: [],
                    violationCount: 0
                }
            ]);
            sinon.assert.calledOnceWithExactly(
                locStub, 
                'codeAnalysisBuildSummaryLine_NoViolations', 
                'some-tool-name'
            );
        });
        
        it('should throw exception in case of unexpected results', () => {
            assert.throws(() => codeAnalysisResultPublisherInstance.createSummaryLine([
                {
                    affectedFileCount: 0,
                    moduleName: 'module-1',
                    originatingTool: {
                        toolName: 'some-tool-name',
                        isEnabled: () => true
                    },
                    resultFiles: [],
                    violationCount: 0
                },
                {
                    affectedFileCount: 2,
                    moduleName: 'module-2',
                    originatingTool: {
                        toolName: 'some-tool-name'
                    },
                    resultFiles: [],
                    violationCount: 1
                }
            ]), Error);
        });
    });
}