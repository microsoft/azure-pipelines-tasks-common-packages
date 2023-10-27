import artifactProviders = require('artifact-engine/Providers');
import azureBlobProvider = require('./azureBlobStorageProvider');
import artifactProcessor = require('artifact-engine/Engine');
import models = require('artifact-engine/Models');

export class BlobService {
    private _storageAccountName: string;
    private _storageAccessKey: string;

    public constructor(storageAccountName: string, storageAccessKey: string) {
        this._storageAccountName = storageAccountName;
        this._storageAccessKey = storageAccessKey;
    }

    public async uploadBlobs(source: string, container: string, prefixFolderPath?: string, itemPattern?: string): Promise<string[]> {
        var fileProvider = new artifactProviders.FilesystemProvider(source);
        var azureProvider = new azureBlobProvider.AzureBlobProvider(this._storageAccountName, container, this._storageAccessKey, prefixFolderPath);
        var processor = new artifactProcessor.ArtifactEngine();
        var processorOptions = new artifactProcessor.ArtifactEngineOptions();
        if (itemPattern) {
            processorOptions.itemPattern = itemPattern;
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
        var azureProvider = new azureBlobProvider.AzureBlobProvider(this._storageAccountName, container, this._storageAccessKey, prefixFolderPath, !!addPrefixToDownloadedItems);
        var processor = new artifactProcessor.ArtifactEngine();
        var processorOptions = new artifactProcessor.ArtifactEngineOptions();
        if (itemPattern) {
            processorOptions.itemPattern = itemPattern;
        }

        await processor.processItems(azureProvider, fileProvider, processorOptions);
    }
}