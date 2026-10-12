import * as assert from "assert";
import * as mocker from "azure-pipelines-task-lib/lib-mocker";

export function webapiUrlTests() {
    let endpointUrl: string;
    let collectionUrl: string;
    let teamFoundationCollectionUrl: string;

    before(() => {
        mocker.disable();
        mocker.enable({
            useCleanCache: true,
            warnOnUnregistered: true
        } as mocker.MockOptions);
    });

    after(() => {
        mocker.disable();
    });

    beforeEach(() => {
        endpointUrl = "https://devops.example.test/organization/";
        collectionUrl = "https://devops.example.test/organization/";
        teamFoundationCollectionUrl = collectionUrl;

        mocker.resetCache();
        mocker.registerAllowable("path");
        mocker.registerAllowable("../webapi");
        mocker.registerAllowable("azure-devops-node-api");
        mocker.registerMock("azure-pipelines-task-lib/task", {
            getEndpointUrl: () => endpointUrl,
            getVariable: (name: string) => {
                if (name === "System.CollectionUri") {
                    return collectionUrl;
                }
                if (name === "System.TeamFoundationCollectionUri") {
                    return teamFoundationCollectionUrl;
                }
                return undefined;
            },
            loc: (key: string) => key,
            setResourcePath: () => {}
        });
    });

    afterEach(() => {
        mocker.deregisterAll();
    });

    it("accepts matching HTTPS system endpoint and collection roots", () => {
        const utils = require("../webapi");

        assert.strictEqual(
            utils.getSystemServiceUrl().href,
            "https://devops.example.test/organization/"
        );
    });

    it("rejects a mismatched system endpoint and collection root", () => {
        endpointUrl = "https://attacker.example/organization/";
        const utils = require("../webapi");

        assert.throws(
            () => utils.getSystemServiceUrl(),
            /Error_SystemConnectionUrlMismatch/
        );
    });

    it("rejects a mismatched Team Foundation collection variable", () => {
        teamFoundationCollectionUrl = "https://attacker.example/organization/";
        const utils = require("../webapi");

        assert.throws(
            () => utils.getSystemServiceUrl(),
            /Error_SystemConnectionUrlMismatch/
        );
    });

    it("rejects an HTTP system endpoint", () => {
        endpointUrl = "http://devops.example.test/organization/";
        const utils = require("../webapi");

        assert.throws(
            () => utils.getSystemServiceUrl(),
            /Error_ServiceUrlHttpsRequired/
        );
    });

}
