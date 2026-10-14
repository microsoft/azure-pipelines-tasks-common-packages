import * as assert from "assert";
import { getAreaIdForProtocol, ProtocolType } from "../protocols";

export function protocolsTests() {
    it("maps Cargo to the Cargo registry area", () => {
        assert.strictEqual(
            getAreaIdForProtocol(ProtocolType.Cargo),
            "71F96160-8701-4914-AED9-C44B89F20CCD"
        );
    });

    it("maps Universal Packages to the UPack area", () => {
        assert.strictEqual(
            getAreaIdForProtocol(ProtocolType.Universal),
            "D397749B-F115-4027-B6DD-77A65DD10D21"
        );
    });

    it("defaults omitted and unsupported protocol values to NuGet", () => {
        assert.strictEqual(
            getAreaIdForProtocol(),
            "B3BE7473-68EA-4A81-BFC7-9530BAAA19AD"
        );
        assert.strictEqual(
            getAreaIdForProtocol(99 as ProtocolType),
            "B3BE7473-68EA-4A81-BFC7-9530BAAA19AD"
        );
    });
}
