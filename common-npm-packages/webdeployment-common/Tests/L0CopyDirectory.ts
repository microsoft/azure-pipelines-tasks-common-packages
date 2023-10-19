import * as assert from "assert";
import * as mockery from "mockery";
import * as path from "path";

export function runCopyDirectoryTests(): void {
    const fileList: string[] = [];
    let mkdirPCount: number;
    let cpfilesCount: number;

    before(() => {

        const taskLibMock = {
            exist: function (path: string): boolean {
                console.log("exist : " + path);
                return fileList.indexOf(path) !== -1;
            },
            find: function (path: string): string[] {
                console.log("find : " + path);
                return fileList.filter(f => f.startsWith(path));
            },
            mkdirP: function (path: string): void {
                if (fileList.indexOf(path) !== -1) {
                    return;
                }
                
                mkdirPCount++;
                fileList.push(path);
                console.log("mkdirp : " + path);
            },
            cp: function (source: string, dest: string, _options: any, _continueOnError: boolean): void {
                if (fileList.indexOf(source) === -1) {
                    return;
                }
                if (fileList.indexOf(dest) !== -1) {
                    return;
                }
                cpfilesCount++;
                fileList.push(dest);
                console.log('cp ' + source + ' to ' + dest);
            },
            stats: function (path: string): any {
                return {
                    isDirectory: function (): boolean {
                        return !path.endsWith('.py') && !path.endsWith('.txt');
                    }
                };
            },
            debug: function (message: string) {
                console.log(message);
            }
        };
        mockery.registerMock('azure-pipelines-task-lib/task', taskLibMock);
        mockery.registerMock('./packageUtility', {});
        mockery.registerMock('./ziputility', {});
        mockery.registerAllowable('../utility');

        mockery.enable({
            useCleanCache: true,
            warnOnReplace: false,
            warnOnUnregistered: false
        });        
    });

    after(() => {
        mockery.disable();
    });

    beforeEach(() => {
        mkdirPCount = 0;
        cpfilesCount = 0;
        fileList.splice(0);
    });


    it("Should copy files and folders as expected", async () => {
        fileList.push(
            path.join("C:", "source", "path"),
            path.join("C:", "source", "path", "myfile.txt"),
            path.join("C:", "source", "path", "New Folder"),
            path.join("C:", "source", "path", "New Folder", "Another New Folder"),
            path.join("C:", "source", "New Folder", "anotherfile.py"),
            path.join("C:", "source", "New Folder", "Another New Folder", "mynewfile.txt")
        );
        const utility = await import('../utility');

        utility.copyDirectory(path.join('C:','source'), path.join('C:', 'destination'));

        assert.strictEqual(cpfilesCount, 3, 'Should create three files');
        assert.strictEqual(mkdirPCount, 6, 'Should create six folder including destination folder');
    });
}