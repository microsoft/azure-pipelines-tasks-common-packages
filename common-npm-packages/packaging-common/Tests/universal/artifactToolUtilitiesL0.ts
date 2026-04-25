import * as assert from "assert";
import * as mocker from "azure-pipelines-task-lib/lib-mocker";

export function artifactToolUtilities() {
    before(() => {
        mocker.disable();
        mocker.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        } as mocker.MockOptions);
    });

    after(() => {
        mocker.disable();
    });

    beforeEach(() => {
        mocker.resetCache();
    });

    afterEach(() => {
        mocker.deregisterAll();
    });

    function createMocks(variables: { [key: string]: string }, toolMetadata: { version: string; uri: string }, cachedToolPath?: string) {
        const defaultVars: { [key: string]: string } = {
            "Agent.TempDirectory": "C:\\temp",
            ...variables
        };
        const mockTl = {
            getVariable: (name: string) => defaultVars[name],
            osType: () => "Windows_NT",
            debug: (_msg: string) => {},
            loc: (key: string, ...args: any[]) => key,
            exist: (_path: string) => true,
            mkdirP: (_path: string) => {}
        };

        const mockToollib = {
            findLocalTool: (_toolName: string, _version: string, _arch?: string) => cachedToolPath || "",
            downloadTool: (_url: string) => Promise.resolve("C:\\temp\\zipped"),
            cacheDir: (_sourceDir: string, _tool: string, version: string, _arch?: string) => Promise.resolve(`C:\\agent\\_tool\\artifacttool\\${version}\\x64`)
        };

        const mockPkgLocationUtils = {
            getWebApiWithProxy: (_serviceUri: string, _accessToken: string) => ({
                vsoClient: {
                    getVersioningData: () => Promise.resolve({ requestUrl: "https://example.com/api" })
                },
                rest: {
                    get: () => Promise.resolve({ statusCode: 200, result: toolMetadata })
                }
            }),
            retryOnExceptionHelper: (fn: () => Promise<any>, _retries: number, _delay: number) => fn()
        };

        const mockAdmZip = function() {
            return { extractAllTo: () => {} };
        };

        const mockOs = {
            arch: () => "x64"
        };

        mocker.registerMock("azure-pipelines-task-lib", mockTl);
        mocker.registerMock("azure-pipelines-task-lib/task", mockTl);
        mocker.registerMock("azure-pipelines-tool-lib/tool", mockToollib);
        mocker.registerMock("../locationUtilities", mockPkgLocationUtils);
        mocker.registerMock("adm-zip", mockAdmZip);
        mocker.registerMock("os", mockOs);

        return { mockToollib };
    }

    it("uses pinned version when UPack.EnableFixedArtifactToolLocation is true", async () => {
        createMocks(
            { "UPack.EnableFixedArtifactToolLocation": "true" },
            { version: "0.2.542", uri: "https://example.com/artifacttool.zip" }
        );

        const artifactToolUtilities = require("../../universal/ArtifactToolUtilities");
        const result = await artifactToolUtilities.getArtifactToolFromService("https://service.com", "token", "artifacttool");

        assert(result.includes("0.0.1-latest"), `Expected path to contain 0.0.1-latest, got: ${result}`);
    });

    it("uses pinned version when UPack.EnableFixedArtifactToolLocation is True (case insensitive)", async () => {
        createMocks(
            { "UPack.EnableFixedArtifactToolLocation": "True" },
            { version: "0.2.542", uri: "https://example.com/artifacttool.zip" }
        );

        const artifactToolUtilities = require("../../universal/ArtifactToolUtilities");
        const result = await artifactToolUtilities.getArtifactToolFromService("https://service.com", "token", "artifacttool");

        assert(result.includes("0.0.1-latest"), `Expected path to contain 0.0.1-latest, got: ${result}`);
    });

    it("uses server version when UPack.EnableFixedArtifactToolLocation is false", async () => {
        const serverVersion = "0.2.542";
        createMocks(
            { "UPack.EnableFixedArtifactToolLocation": "false" },
            { version: serverVersion, uri: "https://example.com/artifacttool.zip" }
        );

        const artifactToolUtilities = require("../../universal/ArtifactToolUtilities");
        const result = await artifactToolUtilities.getArtifactToolFromService("https://service.com", "token", "artifacttool");

        assert(result.includes(serverVersion), `Expected path to contain version ${serverVersion}, got: ${result}`);
    });
}
