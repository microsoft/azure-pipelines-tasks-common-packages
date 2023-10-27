import path = require('path');
import models = require('artifact-engine/Models');
import store = require('artifact-engine/Store');
import tl = require('azure-pipelines-task-lib/task');
import { Readable } from 'stream';
import { BlobItem, BlobServiceClient, ContainerClient, StorageSharedKeyCredential } from '@azure/storage-blob';

const resourcePath: string = path.join(__dirname, 'module.json');
tl.setResourcePath(resourcePath);

export class AzureBlobProvider implements models.IArtifactProvider {

    public artifactItemStore: store.ArtifactItemStore;

    constructor(storageAccount: string, containerName: string, accessKey: string, prefixFolderPath?: string, addPrefixToDownloadedItems?: boolean) {
        this._storageAccount = storageAccount;
        this._accessKey = accessKey;
        this._containerName = containerName;

        if (!!prefixFolderPath) {
            this._prefixFolderPath = prefixFolderPath.endsWith("/") ? prefixFolderPath : prefixFolderPath + "/";
        } else {
            this._prefixFolderPath = "";
        }

        const sharedKeyCredential = new StorageSharedKeyCredential(this._storageAccount, this._accessKey);

        this._blobServiceClient = new BlobServiceClient(
            `https://${this._storageAccount}.blob.core.windows.net`,
            sharedKeyCredential
        );

        this._containerClient = this._blobServiceClient.getContainerClient(this._containerName);
        this._addPrefixToDownloadedItems = !!addPrefixToDownloadedItems;
    }

    public async putArtifactItem(item: models.ArtifactItem, readStream: Readable): Promise<models.ArtifactItem> {
        await this._containerClient.createIfNotExists();
        console.log(tl.loc("UploadingItem", item.path));

        const blobPath = this._prefixFolderPath ? this._prefixFolderPath + "/" + item.path : item.path;
        const blockBlobClient = this._containerClient.getBlockBlobClient(blobPath);
        
        try {
            await blockBlobClient.uploadStream(readStream);
            const blobUrl = blockBlobClient.url + "/" + this._containerName + "/" + blobPath;
            
            console.log(tl.loc("CreatedBlobForItem", item.path, blobUrl));
            item.metadata["destinationUrl"] = blobUrl;
            
            return item;
        } catch (error) {
            console.log(tl.loc("FailedToUploadBlob", blobPath, error.message));
            throw error;
        }
    }

    public getRootItems(): Promise<models.ArtifactItem[]> {
        return this._getItems(this._containerName, this._prefixFolderPath);
    }

    public getArtifactItems(artifactItem: models.ArtifactItem): Promise<models.ArtifactItem[]> {
        throw new Error(tl.loc("GetArtifactItemsNotSupported"));
    }

    public async getArtifactItem(artifactItem: models.ArtifactItem): Promise<NodeJS.ReadableStream> {
        let blobPath = artifactItem.path;

        if (!this._addPrefixToDownloadedItems && !!this._prefixFolderPath) {
            blobPath += this._prefixFolderPath;
        }

        const blockBlobClient = this._containerClient.getBlockBlobClient(blobPath);
    
        try {
            const downloadResponse = await blockBlobClient.download();

            // Replace full path by filename in order to save the file directly to destination folder
            artifactItem.path = path.basename(artifactItem.path);
            return downloadResponse.readableStreamBody;
        } catch (error) {
            console.log(tl.loc("FailedToDownloadBlob", blobPath, error.message));
            throw error;
        }
    }

    public dispose() {
    }

    private async _getItems(container: string, parentRelativePath?: string): Promise<models.ArtifactItem[]> { 
        try {
            const result = await this._getListOfItemsInsideContainer(container, parentRelativePath);
            const artifactItems: models.ArtifactItem[] = this._convertBlobResultToArtifactItem(result);

            console.log(tl.loc("SuccessFullyFetchedItemList"));

            return artifactItems;
        } catch (error) {
            console.log(tl.loc("FailedToListItemInsideContainer", container, error.message));
            throw error;
        }
    }

    private async _getListOfItemsInsideContainer(containerName: string, parentRelativePath: string): Promise<BlobItem[]> {
        const options = { prefix: parentRelativePath };
        const items: BlobItem[] = [];
        const maxPageSize = 100;

        for await (const page of this._containerClient.listBlobsFlat(options).byPage({ maxPageSize })) {
            for (const blob of page.segment.blobItems) {
                items.push(blob);
            }
        }

        return items;
    }

    private _convertBlobResultToArtifactItem(blobItems: BlobItem[]): models.ArtifactItem[] {
        var artifactItems: models.ArtifactItem[] = new Array<models.ArtifactItem>();
        blobItems.forEach(item => {
            var artifactitem: models.ArtifactItem = new models.ArtifactItem();
            artifactitem.itemType = models.ItemType.File;
            artifactitem.fileLength = item.properties.contentLength;
            artifactitem.lastModified = new Date(item.properties.lastModified + 'Z');
            if (!this._addPrefixToDownloadedItems && !!this._prefixFolderPath) {
                 // Supplying relative path without prefix; removing the first occurence
                artifactitem.path = item.name.replace(this._prefixFolderPath, "").trim();
            } else {
                artifactitem.path = item.name;
            }
            artifactItems.push(artifactitem);
        });

        return artifactItems;
    }

    private _storageAccount: string;
    private _accessKey: string;
    private _containerName: string;
    private _containerClient: ContainerClient;
    private _blobServiceClient: BlobServiceClient;
    private _prefixFolderPath: string;
    private _addPrefixToDownloadedItems: boolean = false;
}