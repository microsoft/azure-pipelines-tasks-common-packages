import * as assert from "assert";
import * as mocker from "azure-pipelines-task-lib/lib-mocker";
import { ProtocolType } from "../protocols";

export function feedUrlUtilsTests() {
    let packagingUris: string[];
    let connectionDataCalls: number;
    let connectionDataProtocol: ProtocolType | undefined;

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
        connectionDataProtocol = undefined;

        mocker.resetCache();
        mocker.registerAllowable("path");
        mocker.registerAllowable("../feedUrlUtils");
        mocker.registerAllowable("./protocols");
        mocker.registerMock("azure-pipelines-task-lib/task", {
            loc: (key: string) => key,
            setResourcePath: () => {}
        });
        mocker.registerMock("./connectionDataUtils", {
            getConnectionDataForProtocol: async (protocolType: ProtocolType) => {
                connectionDataCalls++;
                connectionDataProtocol = protocolType;
                return { locationServiceData: {} };
            }
        });
        mocker.registerMock("./packagingAccessMappingUtils", {
            getHttpsPackagingAccessMappings: () =>
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
            new URL("HTTPS://PKGS.EXAMPLE.TEST/organization/_packaging/feed/pypi/simple"),
            ProtocolType.PyPi
        );

        assert.strictEqual(
            verifiedUrl.href,
            "https://pkgs.example.test/organization/_packaging/feed/pypi/simple"
        );
        assert.strictEqual(connectionDataCalls, 1);
    });

    it("defaults omitted protocols to NuGet discovery", async () => {
        const feedUrlUtils = require("../feedUrlUtils");

        await feedUrlUtils.verifyAzureArtifactsFeedUrl(
            new URL("https://pkgs.example.test/organization/feed")
        );

        assert.strictEqual(connectionDataProtocol, ProtocolType.NuGet);
    });

    it("rejects a feed on an origin not returned by authenticated discovery", async () => {
        const feedUrlUtils = require("../feedUrlUtils");

        await assert.rejects(
            () => feedUrlUtils.verifyAzureArtifactsFeedUrl(
                new URL("https://attacker.example/organization/feed"),
                ProtocolType.NuGet
            ),
            /Error_FeedUrlUntrustedHost/
        );
        assert.strictEqual(connectionDataCalls, 1);
    });

    it("accepts any path on an authenticated Azure Artifacts host", async () => {
        const feedUrlUtils = require("../feedUrlUtils");

        const verifiedUrl = await feedUrlUtils.verifyAzureArtifactsFeedUrl(
            new URL("https://pkgs.example.test/another-organization/feed"),
            ProtocolType.NuGet
        );

        assert.strictEqual(
            verifiedUrl.href,
            "https://pkgs.example.test/another-organization/feed"
        );
    });

    it("accepts embedded credentials on an authenticated Azure Artifacts host", async () => {
        const feedUrlUtils = require("../feedUrlUtils");

        const verifiedUrl = await feedUrlUtils.verifyAzureArtifactsFeedUrl(
            new URL("https://username:password@pkgs.example.test/organization/feed"),
            ProtocolType.NuGet
        );

        assert.strictEqual(
            verifiedUrl.href,
            "https://username:password@pkgs.example.test/organization/feed"
        );
    });

    it("accepts another Azure DevOps-owned visualstudio.com packaging host", async () => {
        packagingUris = ["https://source.pkgs.visualstudio.com/"];
        const feedUrlUtils = require("../feedUrlUtils");

        const verifiedUrl = await feedUrlUtils.verifyAzureArtifactsFeedUrl(
            new URL("https://target.pkgs.visualstudio.com/feed"),
            ProtocolType.NuGet
        );

        assert.strictEqual(
            verifiedUrl.href,
            "https://target.pkgs.visualstudio.com/feed"
        );
    });

    it("accepts a legacy feed with a modern authenticated mapping", async () => {
        packagingUris = ["https://pkgs.dev.azure.com/source/"];
        const feedUrlUtils = require("../feedUrlUtils");

        const verifiedUrl = await feedUrlUtils.verifyAzureArtifactsFeedUrl(
            new URL("https://target.pkgs.visualstudio.com/feed"),
            ProtocolType.NuGet
        );

        assert.strictEqual(
            verifiedUrl.href,
            "https://target.pkgs.visualstudio.com/feed"
        );
    });

    it("accepts a modern feed with a legacy authenticated mapping", async () => {
        packagingUris = ["https://source.pkgs.visualstudio.com/"];
        const feedUrlUtils = require("../feedUrlUtils");

        const verifiedUrl = await feedUrlUtils.verifyAzureArtifactsFeedUrl(
            new URL("https://pkgs.dev.azure.com/target/feed"),
            ProtocolType.NuGet
        );

        assert.strictEqual(
            verifiedUrl.href,
            "https://pkgs.dev.azure.com/target/feed"
        );
    });

    it("accepts a dev.azure.com URL with a Packaging mapping", async () => {
        packagingUris = ["https://pkgs.dev.azure.com/source/"];
        const feedUrlUtils = require("../feedUrlUtils");

        const verifiedUrl = await feedUrlUtils.verifyAzureArtifactsFeedUrl(
            new URL("https://dev.azure.com/target/"),
            ProtocolType.Universal
        );

        assert.strictEqual(
            verifiedUrl.href,
            "https://dev.azure.com/target/"
        );
    });

    it("accepts a Packaging URL with a dev.azure.com mapping", async () => {
        packagingUris = ["https://dev.azure.com/source/"];
        const feedUrlUtils = require("../feedUrlUtils");

        const verifiedUrl = await feedUrlUtils.verifyAzureArtifactsFeedUrl(
            new URL("https://pkgs.dev.azure.com/target/"),
            ProtocolType.Universal
        );

        assert.strictEqual(
            verifiedUrl.href,
            "https://pkgs.dev.azure.com/target/"
        );
    });

    it("accepts a cross-organization CodeDev feed", async () => {
        packagingUris = ["https://source.codedev.ms/"];
        const feedUrlUtils = require("../feedUrlUtils");

        const verifiedUrl = await feedUrlUtils.verifyAzureArtifactsFeedUrl(
            new URL("https://target.codedev.ms/feed"),
            ProtocolType.NuGet
        );

        assert.strictEqual(
            verifiedUrl.href,
            "https://target.codedev.ms/feed"
        );
    });

    it("accepts equivalent DevFabric Packaging hosts", async () => {
        packagingUris = ["https://source.vsts.me/"];
        const feedUrlUtils = require("../feedUrlUtils");

        const verifiedUrl = await feedUrlUtils.verifyAzureArtifactsFeedUrl(
            new URL("https://pkgs.devppe.azure.com/target/feed"),
            ProtocolType.NuGet
        );

        assert.strictEqual(
            verifiedUrl.href,
            "https://pkgs.devppe.azure.com/target/feed"
        );
    });

    it("does not authorize a DevFabric feed from a production mapping", async () => {
        packagingUris = ["https://pkgs.dev.azure.com/source/"];
        const feedUrlUtils = require("../feedUrlUtils");

        await assert.rejects(
            () => feedUrlUtils.verifyAzureArtifactsFeedUrl(
                new URL("https://target.codedev.ms/feed"),
                ProtocolType.NuGet
            ),
            /Error_FeedUrlUntrustedHost/
        );
    });

    it("rejects HTTP before authenticated discovery", async () => {
        const feedUrlUtils = require("../feedUrlUtils");

        await assert.rejects(
            () => feedUrlUtils.verifyAzureArtifactsFeedUrl(
                new URL("http://pkgs.example.test/organization/feed"),
                ProtocolType.NuGet
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
                new URL("https://pkgs.example.test/organization/feed"),
                ProtocolType.NuGet
            ),
            /Error_FeedUrlHttpsRequired/
        );
    });
}
