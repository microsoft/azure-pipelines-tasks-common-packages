import { BaseToolTests } from './BaseToolTests';
import { BuildOutputTests } from './BuildOutputTests';
import { CheckstyleToolTests } from './CheckstyleToolTests';
import { CodeAnalysisOrchestratorTests } from './CodeAnalysisOrchestratorTests';
import { CodeAnalysisResultPublisherTests } from './CodeAnalysisResultPublisherTests';
import { FileSystemInteractionsTests } from './FileSystemInteractionsTests';

describe('codeanalysis-common suite', () => {
    describe('BaseTool', BaseToolTests);
    describe('BuildOutput', BuildOutputTests);
    describe('CheckstyleTool', CheckstyleToolTests);
    describe('CodeAnalysisOrchestrator', CodeAnalysisOrchestratorTests);
    describe('CodeAnalysisResultPublisher', CodeAnalysisResultPublisherTests);
    describe('FileSystemInteractions', FileSystemInteractionsTests)
})