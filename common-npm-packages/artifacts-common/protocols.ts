export enum ProtocolType {
    NuGet,
    Maven,
    Npm,
    PyPi,
    Cargo,
    Universal
}

export function getAreaIdForProtocol(
    protocolType: ProtocolType = ProtocolType.NuGet
): string {
    switch (protocolType) {
        case ProtocolType.Maven:
            return '6F7F8C07-FF36-473C-BCF3-BD6CC9B6C066';
        case ProtocolType.Npm:
            return '4C83CFC1-F33A-477E-A789-29D38FFCA52E';
        case ProtocolType.PyPi:
            return '92F0314B-06C5-46E0-ABE7-15FD9D13276A';
        case ProtocolType.Cargo:
            return '71F96160-8701-4914-AED9-C44B89F20CCD';
        case ProtocolType.Universal:
            return 'D397749B-F115-4027-B6DD-77A65DD10D21';
        default:
        case ProtocolType.NuGet:
            return 'B3BE7473-68EA-4A81-BFC7-9530BAAA19AD';
    }
}