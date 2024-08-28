import * as assert from "assert";
import * as mockery from "azure-pipelines-task-lib/lib-mocker";


export function runGenerateWebCongigTests() {
    let webConfigContents: string;

    before(() => {

        libMocker.registerMock('azure-pipelines-task-lib/task', {
            writeFile: function (_file: string, data: string, _options: any): void {
                console.log("web.config contents: " + data);
                webConfigContents = data;
            },
            debug: function(message: string): void {
                console.log("##[debug]: " + message);
            }
        });

        libMocker.registerMock('fs', {
            readFileSync: function (_path: string, _format: string): string {
                return "{NodeStartFile};{Handler}"
            }
        });

        libMocker.registerAllowable("../webconfigutil");

        libMocker.enable({
            useCleanCache: true,
            warnOnReplace: false,
            warnOnUnregistered: false
        });
    });

    after(() => {
        libMocker.disable();
    });

    beforeEach(() => { 
        webConfigContents = ""; 
    });

    it("Should replace substitution parameters", async () => {
        const util = await import("../webconfigutil");
        const parameters = {
            NodeStartFile: "server.js", 
            Handler: "iisnode"
        };
        util.generateWebConfigFile("web.config", "node", parameters);
        assert.strictEqual(webConfigContents, "server.js;iisnode");
    });
}
