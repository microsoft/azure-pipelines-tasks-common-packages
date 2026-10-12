import * as assert from "assert";
import * as mocker from "azure-pipelines-task-lib/lib-mocker";

export function feedUrlUtilsTests() {
    let packagingUris: string[];
    let connectionDataCalls: number;

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
        packagingUris = ["https://pkgs.example.test/organization/"];
        connectionDataCalls = 0;

        mocker.resetCache();
        mocker.registerAllowable("path");
        mocker.registerAllowable("../feedUrlUtils");
        mocker.registerAllowable("./protocols");
        mocker.registerMock("azure-pipelines-task-lib/task", {
            loc: (key: string) => key,
            setResourcePath: () => {}
        });
        mocker.registerMock("./connectionDataUtils", {
            getConnectionDataForProtocol: async (_protocolType: number) => {
                connectionDataCalls++;
                return { locationServiceData: {} };
            }
        });
        mocker.registerMock("./packagingAccessMappingUtils", {
            getPackagingAccessMappings: () =>
                packagingUris.map(uri => {
                    if (uri.startsWith("http:")) {
                        throw new Error("Error_ServiceUrlHttpsRequired");
                    }
                    return { uri };
                })
        });
    });

    afterEach(() => {
        mocker.deregisterAll();
    });

    it("accepts a feed within an authenticated Packaging access mapping", async () => {
        const feedUrlUtils = require("../feedUrlUtils");
        const verifiedUrl = await feedUrlUtils.verifyAzureArtifactsFeedUrl(
            new URL("HTTPS://PKGS.EXAMPLE.TEST/organization/_packaging/feed/pypi/simple")
        );

        assert.strictEqual(
            verifiedUrl.href,
            "https://pkgs.example.test/organization/_packaging/feed/pypi/simple"
        );
        assert.strictEqual(connectionDataCalls, 1);
    });

    it("rejects a feed on an origin not returned by authenticated discovery", async () => {
        const feedUrlUtils = require("../feedUrlUtils");

        await assert.rejects(
            () => feedUrlUtils.verifyAzureArtifactsFeedUrl(
                new URL("https://attacker.example/organization/feed")
            ),
            /Error_FeedUrlUntrustedHost/
        );
        assert.strictEqual(connectionDataCalls, 1);
    });

    it("accepts any path on an authenticated Azure Artifacts host", async () => {
        const feedUrlUtils = require("../feedUrlUtils");

        const verifiedUrl = await feedUrlUtils.verifyAzureArtifactsFeedUrl(
            new URL("https://pkgs.example.test/another-organization/feed")
        );

        assert.strictEqual(
            verifiedUrl.href,
            "https://pkgs.example.test/another-organization/feed"
        );
    });

    it("accepts another Azure DevOps-owned visualstudio.com packaging host", async () => {
        packagingUris = ["https://source.pkgs.visualstudio.com/"];
        const feedUrlUtils = require("../feedUrlUtils");

        const verifiedUrl = await feedUrlUtils.verifyAzureArtifactsFeedUrl(
            new URL("https://target.pkgs.visualstudio.com/feed")
        );

        assert.strictEqual(
            verifiedUrl.href,
            "https://target.pkgs.visualstudio.com/feed"
        );
    });

    it("rejects HTTP before authenticated discovery", async () => {
        const feedUrlUtils = require("../feedUrlUtils");

        await assert.rejects(
            () => feedUrlUtils.verifyAzureArtifactsFeedUrl(
                new URL("http://pkgs.example.test/organization/feed")
            ),
            /Error_FeedUrlHttpsRequired/
        );
        assert.strictEqual(connectionDataCalls, 0);
    });

    it("rejects an insecure access mapping from authenticated discovery", async () => {
        packagingUris = ["http://pkgs.example.test/organization/"];
        const feedUrlUtils = require("../feedUrlUtils");

        await assert.rejects(
            () => feedUrlUtils.verifyAzureArtifactsFeedUrl(
                new URL("https://pkgs.example.test/organization/feed")
            ),
            /Error_FeedUrlHttpsRequired/
        );
    });
}
