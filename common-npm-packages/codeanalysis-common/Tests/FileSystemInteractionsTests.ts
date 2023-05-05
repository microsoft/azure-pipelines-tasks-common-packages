import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as rewire from 'rewire';
import * as shell from 'shelljs';
import * as sinon from 'sinon';
import * as tl from 'azure-pipelines-task-lib/task';
import { FakeFsException } from './Fakes/FakeTool';

export function FileSystemInteractionsTests() {
    const sandbox = sinon.createSandbox();
    const fileSystemInteractionsRewired = rewire('../Common/FileSystemInteractions');
    const fileSystemInteractionsClass = fileSystemInteractionsRewired.__get__('FileSystemInteractions');
    
    describe('function \'copyFile\'', () => {
        let cpStub;
        
        before(() => {
            cpStub = sandbox.stub(shell, 'cp');
            sandbox.stub(fileSystemInteractionsClass, 'checkShell');
        });
        
        after(() => {
            sandbox.restore();
        });
        
        afterEach(() => {
            cpStub.reset();
        });
        
        it('should call \'cp\' function with correct parameters', () => {
            fileSystemInteractionsClass.copyFile('source/file.log', 'destination/file.log');
            sinon.assert.calledOnceWithExactly(cpStub, '-f', 'source/file.log', 'destination/file.log');
        });
    });
    
    describe('function \'createDirectory\'', () => {
        let statSyncStub, mkdirSyncStub, locStub;
        
        before(() => {
            mkdirSyncStub = sandbox.stub(fs, 'mkdirSync');
            statSyncStub = sandbox.stub(fs, 'statSync').returns({ isDirectory() { return false }});
            sandbox.stub(tl, 'debug');
            locStub = sandbox.stub(tl, 'loc');
            sandbox.stub(fileSystemInteractionsClass, 'checkShell');
        });
        
        after(() => {
            sandbox.restore();
        });
        
        afterEach(() => {
            statSyncStub.reset();
            mkdirSyncStub.reset();
            locStub.reset();
        });
        
        it('should throw exception from fs if path contains more then 1000 folders to create', () => {
            mkdirSyncStub.callsFake(() => { throw new Error() });
            statSyncStub.callsFake(() => { throw new FakeFsException('ENOENT') });
            const longDirectory = getLongDirectoryPath(1010);
            assert.throws(() => fileSystemInteractionsClass.createDirectory(longDirectory));
            sinon.assert.calledOnce(mkdirSyncStub);
        });
        
        it('should throw exception if root directory doesn\'t exist', () => {
            statSyncStub.callsFake(() => { throw new FakeFsException('ENOENT') });
            const directoryToCreate = getLongDirectoryPath(10);
            assert.throws(() => fileSystemInteractionsClass.createDirectory(directoryToCreate));
            sinon.assert.calledOnceWithExactly(locStub, 'LIB_MkdirFailedInvalidDriveRoot', directoryToCreate, 'C:\\');
        });
        
        it('should throw exception if there is exception with code \'UNKNOWN\'', () => {
            statSyncStub.callsFake(() => { throw new FakeFsException('UNKNOWN') });
            const directoryToCreate = getLongDirectoryPath(10);
            assert.throws(() => fileSystemInteractionsClass.createDirectory(directoryToCreate));
            sinon.assert.calledOnceWithExactly(locStub, 'LIB_MkdirFailedInvalidShare', directoryToCreate, directoryToCreate);
        });
        
        it('should rethrow exception if it\'s code is not equal to \'ENOENT\' or \'UNKNOWN\'', () => {
            statSyncStub.callsFake(() => { throw new FakeFsException('ANOTHER CODE') });
            const directoryToCreate = getLongDirectoryPath(10);
            assert.throws(() => fileSystemInteractionsClass.createDirectory(directoryToCreate));
            sinon.assert.notCalled(mkdirSyncStub);
        });
        
        it('should throw exception if creating path is not a directory one', () => {
            statSyncStub.callsFake(() => ({ isDirectory() { return false }}));
            const directoryToCreate = getLongDirectoryPath(10);
            assert.throws(() => fileSystemInteractionsClass.createDirectory(directoryToCreate));
            sinon.assert.calledOnceWithExactly(locStub, 'LIB_MkdirFailedFileExists', directoryToCreate, directoryToCreate);
        });
    });
    
    function getLongDirectoryPath(countNestedDirectories: number) {
        return 'C:\\' + [...Array(countNestedDirectories)].map((_, i) => `folder${i}`).join('\\');
    }
}