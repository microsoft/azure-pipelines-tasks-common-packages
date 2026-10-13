import { packagingAccessMappingUtilsTests } from "./packagingAccessMappingUtilsTests";
import { credentialProviderUtilsTests } from "./credentialProviderUtilsTests";
import { serviceConnectionUtilsTests } from "./serviceConnectionUtilsTests";
import { feedUrlUtilsTests } from "./feedUrlUtilsTests";
import { entraWifUserServiceConnectionUtilsTests } from "./EntraWifUserServiceConnectionUtilsTests";
import { webapiUrlTests } from "./webapiUrlTests";
import { protocolsTests } from "./protocolsTests";

describe("artifacts-common suite", function() {
    describe("packagingAccessMappingUtils", packagingAccessMappingUtilsTests);
    describe("credentialProviderUtils", credentialProviderUtilsTests);
    describe("serviceConnectionUtils", serviceConnectionUtilsTests);
    describe("feedUrlUtils", feedUrlUtilsTests);
    describe("EntraWifUserServiceConnectionUtils", entraWifUserServiceConnectionUtilsTests);
    describe("webapi URL validation", webapiUrlTests);
    describe("protocols", protocolsTests);
});
