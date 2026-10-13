export declare enum ProtocolType {
    NuGet = 0,
    Maven = 1,
    Npm = 2,
    PyPi = 3,
    Cargo = 4,
    Universal = 5,
}
export declare function getAreaIdForProtocol(protocolType?: ProtocolType): string;
