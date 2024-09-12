import artifactProviders = require('artifact-engine/Providers');
import azureBlobProvider = require('./azureBlobStorageProvider');
import artifactProcessor = require('artifact-engine/Engine');
import models = require('artifact-engine/Models');
import { ClientSecretCredential } from '@azure/identity';

export class BlobService {
    private _storageAccountName: string;
    private _storageAccessKey: string;
    private _credential?: ClientSecretCredential;
    private _host: string;

    /**
     * @deprecated
     * Use `createWithStorageAccountAccessKey` or `createWithClientSecretCredential` instead.
     */
    public constructor(storageAccountName: string, storageAccessKey: string, host?: string) {
        this._storageAccountName = storageAccountName;
        this._storageAccessKey = storageAccessKey;
        this._host = host;
    }

    // Static factory method for using Storage Account Access Key
    public static createWithStorageAccountAccessKey(storageAccountName: string, storageAccountAccessKey: string, host?: string): BlobService {
        return new BlobService(storageAccountName, storageAccountAccessKey, host);
    }

    // Static factory method for using ClientSecretCredential
    public static createWithClientSecretCredential(storageAccountName: string, credential: ClientSecretCredential, host?: string): BlobService {
        // Create an instance using a dummy access key and then set the credential
        const instance = new BlobService(storageAccountName, undefined, host);
        instance._credential = credential;
        return instance;
    }

    public async uploadBlobs(source: string, container: string, prefixFolderPath?: string, itemPattern?: string): Promise<string[]> {
        var fileProvider = new artifactProviders.FilesystemProvider(source);

        var processor = new artifactProcessor.ArtifactEngine();
        var processorOptions = new artifactProcessor.ArtifactEngineOptions();
        
        //TODO: Check if _credential is populated. If yes, create AzureBlobProvider with it.
        let azureProvider: azureBlobProvider.AzureBlobProvider;
        if (this._credential) {
            // Create AzureBlobProvider using ClientSecretCredential
            //azureProvider = new azureBlobProvider.AzureBlobProvider(this._storageAccountName, container, this._credential, prefixFolderPath, this._host);
        } else {
            // Use the storage access key if no credential is provided
            azureProvider = new azureBlobProvider.AzureBlobProvider(this._storageAccountName, container, this._storageAccessKey, prefixFolderPath, this._host);
        }

        var uploadedItemTickets = await processor.processItems(fileProvider, azureProvider);

        var uploadedUrls: string[] = [];
        uploadedItemTickets.forEach((ticket: models.ArtifactDownloadTicket) => {
            if (ticket.state === models.TicketState.Processed && ticket.artifactItem.itemType === models.ItemType.File) {
                uploadedUrls.push(ticket.artifactItem.metadata[models.Constants.DestinationUrlKey]);
            }
        });

        return uploadedUrls;
    }

    public async downloadBlobs(destination: string, container: string, prefixFolderPath?: string, itemPattern?: string, addPrefixToDownloadedItems?: boolean): Promise<void> {
        var fileProvider = new artifactProviders.FilesystemProvider(destination);
        //TODO: Revise this init too
        var azureProvider = new azureBlobProvider.AzureBlobProvider(this._storageAccountName, container, this._storageAccessKey, prefixFolderPath, this._host, !!addPrefixToDownloadedItems);
        var processor = new artifactProcessor.ArtifactEngine();
        var processorOptions = new artifactProcessor.ArtifactEngineOptions();
        if (itemPattern) {
            processorOptions.itemPattern = itemPattern;
        }

        await processor.processItems(azureProvider, fileProvider, processorOptions);
    }
}