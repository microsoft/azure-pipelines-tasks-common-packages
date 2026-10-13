import * as assert from "assert";
import * as tl from "azure-pipelines-task-lib/task";
import {
    getHttpsPackagingAccessMappings,
    getPackagingAccessMappings,
    PackagingAccessMapping
} from "../packagingAccessMappingUtils";

export function packagingAccessMappingUtilsTests() {
    const standardDefaultAccessMappingMoniker = "PublicAccessMapping";

    function getAccessMappings(newDomain) {
        let publicAccessPoint = "https://contoso.pkgs.visualstudio.com/"
        if (newDomain) {
            publicAccessPoint = "https://pkgs.dev.azure.com/contoso/";
        }
        return [
            {
                displayName: "Host Guid Access Mapping",
                moniker: "HostGuidAccessMapping",
                accessPoint: "https://pkgsprodscussu0.pkgs.visualstudio.com/",
                serviceOwner: "00000000-0000-0000-0000-000000000000",
                virtualDirectory: "Aa731d82f-a042-44ad-a928-61581ea38485"
            },
            {
                displayName: "Public Access Mapping",
                moniker: "PublicAccessMapping",
                accessPoint: publicAccessPoint,
                serviceOwner: "00000000-0000-0000-0000-000000000000",
                virtualDirectory: ""
            },
            {
                displayName: "VSTS Access Mapping",
                moniker: "VstsAccessMapping",
                accessPoint: "https://contoso.pkgs.visualstudio.com/",
                serviceOwner: "00000000-0000-0000-0000-000000000000",
                virtualDirectory: ""
            },
            {
                displayName: "Codex Access Mapping",
                moniker: "CodexAccessMapping",
                accessPoint: "https://pkgs.dev.azure.com/contoso/",
                serviceOwner: "00000000-0000-0000-0000-000000000000",
                virtualDirectory: ""
            }];
    }


    beforeEach(() => {
    });

    afterEach(() => {
    });

    it("getPackagingAccessMappings pkgs.visualstudio.com default", (done: MochaDone) => {
        const mappings = getPackagingAccessMappings({
            defaultAccessMappingMoniker: standardDefaultAccessMappingMoniker,
            accessMappings: getAccessMappings(false)});

        assert.deepEqual(mappings, <PackagingAccessMapping[]>[
            {
                uri: "https://pkgsprodscussu0.pkgs.visualstudio.com/Aa731d82f-a042-44ad-a928-61581ea38485/",
                isPublic: false,
                isDefault: false
            },
            {
                uri: "https://contoso.pkgs.visualstudio.com/",
                isPublic: true,
                isDefault: true
            },      
            {
                uri: "https://contoso.pkgs.visualstudio.com/",
                isPublic: true,
                isDefault: false
            },
            {
                uri: "https://pkgs.dev.azure.com/contoso/",
                isPublic: true,
                isDefault: false
            }
        ]);

        done();
    });

    it("getPackagingAccessMappings pkgs.dev.azure.com default", (done: MochaDone) => {
        const mappings = getPackagingAccessMappings({
            defaultAccessMappingMoniker: standardDefaultAccessMappingMoniker,
            accessMappings: getAccessMappings(true)});

        assert.deepEqual(mappings, <PackagingAccessMapping[]>[
            {
                uri: "https://pkgsprodscussu0.pkgs.visualstudio.com/Aa731d82f-a042-44ad-a928-61581ea38485/",
                isPublic: false,
                isDefault: false
            },
            {
                uri: "https://pkgs.dev.azure.com/contoso/",
                isPublic: true,
                isDefault: true
            },      
            {
                uri: "https://contoso.pkgs.visualstudio.com/",
                isPublic: true,
                isDefault: false
            },
            {
                uri: "https://pkgs.dev.azure.com/contoso/",
                isPublic: true,
                isDefault: false
            }
        ]);

        done();
    });

    it("getPackagingAccessMappings adds trailing slash if missing", (done: MochaDone) => {
        const mappings = getPackagingAccessMappings({
            defaultAccessMappingMoniker: standardDefaultAccessMappingMoniker,
            accessMappings: [
                {
                    moniker: "MissingSlashAccessMapping",
                    accessPoint: "https://pkgs.dev.azure.com/contoso"
                }
            ]});

        assert.deepEqual(mappings, [
            {
                uri: "https://pkgs.dev.azure.com/contoso/",
                isPublic: false,
                isDefault: false
            }
        ]);

        done();
    });

    it("getPackagingAccessMappings preserves legacy HTTP access mappings", (done: MochaDone) => {
        const mappings = getPackagingAccessMappings({
            defaultAccessMappingMoniker: standardDefaultAccessMappingMoniker,
            accessMappings: [
                {
                    moniker: "LegacyAccessMapping",
                    accessPoint: "http://server.example/collection"
                }
            ]
        });

        assert.strictEqual(
            mappings[0].uri,
            "http://server.example/collection/"
        );

        done();
    });

    it("getHttpsPackagingAccessMappings rejects HTTP access mappings", (done: MochaDone) => {
        assert.throws(
            () => getHttpsPackagingAccessMappings({
                defaultAccessMappingMoniker: standardDefaultAccessMappingMoniker,
                accessMappings: [
                    {
                        moniker: "InsecureAccessMapping",
                        accessPoint: "http://server.example/collection"
                    }
                ]
            }),
            (error: Error) =>
                error.message === tl.loc("Error_ServiceUrlHttpsRequired")
        );

        done();
    });

    it("getHttpsPackagingAccessMappings preserves the normalized mapping", (done: MochaDone) => {
        const mappings = getHttpsPackagingAccessMappings({
            defaultAccessMappingMoniker: standardDefaultAccessMappingMoniker,
            accessMappings: [
                {
                    moniker: "SecureAccessMapping",
                    accessPoint: "HTTPS://PKGS.EXAMPLE.TEST:443/collection"
                }
            ]
        });

        assert.strictEqual(
            mappings[0].uri,
            "HTTPS://PKGS.EXAMPLE.TEST:443/collection/"
        );

        done();
    });
}
