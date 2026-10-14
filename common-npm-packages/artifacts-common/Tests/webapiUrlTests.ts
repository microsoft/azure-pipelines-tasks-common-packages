import * as assert from "assert";
import * as mocker from "azure-pipelines-task-lib/lib-mocker";

export function webapiUrlTests() {
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
        mocker.resetCache();
        mocker.registerAllowable("path");
        mocker.registerAllowable("../webapi");
        mocker.registerAllowable("azure-devops-node-api");
        mocker.registerMock("azure-pipelines-task-lib/task", {
            loc: (key: string) => key,
            setResourcePath: () => {}
        });
    });

    afterEach(() => {
        mocker.deregisterAll();
    });

    it("accepts an HTTPS URL", () => {
        const utils = require("../webapi");

        assert.strictEqual(
            utils.requireHttpsUrl(
                "https://devops.example.test/organization/"
            ).href,
            "https://devops.example.test/organization/"
        );
    });

    it("accepts an HTTPS URL with an embedded username", () => {
        const utils = require("../webapi");

        assert.doesNotThrow(
            () => utils.requireHttpsUrl(
                "https://user@example.test/organization/"
            )
        );
    });

    it("accepts an HTTPS URL with an embedded password", () => {
        const utils = require("../webapi");

        assert.doesNotThrow(
            () => utils.requireHttpsUrl(
                "https://user:password@example.test/organization/"
            )
        );
    });

    it("rejects an invalid URL", () => {
        const utils = require("../webapi");

        assert.throws(
            () => utils.requireHttpsUrl("not a URL"),
            /Error_UrlInvalid/
        );
    });

    it("rejects an HTTP URL", () => {
        const utils = require("../webapi");

        assert.throws(
            () => utils.requireHttpsUrl(
                "http://devops.example.test/organization/"
            ),
            /Error_UrlHttpsRequired/
        );
    });

}
