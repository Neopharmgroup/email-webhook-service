const { BlobServiceClient, BlobSASPermissions } = require('@azure/storage-blob');

const blobServiceClient = BlobServiceClient.fromConnectionString(
    process.env.AZURE_STORAGE_CONNECTION_STRING 
);

const uploadBase64File = async (containerName, base64String, blobName, contentType = null) => {
    try {
        const base64Data = base64String.replace(/^data:.*?;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        const containerClient = blobServiceClient.getContainerClient(containerName);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        const options = {};
        if (contentType) {
            options.blobHTTPHeaders = { blobContentType: contentType,blobContentEncoding: 'utf-8'};
        }

        const uploadResponse = await blockBlobClient.upload(buffer, buffer.length, options);
        return { success: true, blobName, response: uploadResponse };
    } catch (error) {
        console.error(`Error uploading file: ${error.message}`);
        throw error;
    }
};

const downloadFile = async (containerName, blobName) => {
    try {
        const containerClient = blobServiceClient.getContainerClient(containerName);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        const downloadResponse = await blockBlobClient.downloadToBuffer();
        return downloadResponse;
    } catch (error) {
        console.error(`Error downloading file: ${error.message}`);
        throw error;
    }
};

const listFiles = async (containerName, prefix = '') => {
    try {
        const containerClient = blobServiceClient.getContainerClient(containerName);
        const files = [];

        for await (const blob of containerClient.listBlobsFlat({ prefix })) {
            files.push({
                name: blob.name,
                size: blob.properties.contentLength,
                lastModified: blob.properties.lastModified,
                contentType: blob.properties.contentType
            });
        }

        return files;
    } catch (error) {
        console.error(`Error listing files: ${error.message}`);
        throw error;
    }
};

const deleteFile = async (containerName, folderName, blobName) => {
    try {
        const containerClient = blobServiceClient.getContainerClient(containerName);
        const fullBlobPath = folderName ? `${folderName}/${blobName}` : blobName;
        const blockBlobClient = containerClient.getBlockBlobClient(fullBlobPath);

        await blockBlobClient.delete();
        return { success: true, blobName: fullBlobPath };
    } catch (error) {
        console.error(`Error deleting file: ${error.message}`);
        throw error;
    }
};

const getFileUrl = async (containerName, blobName) => {
    try {
        const containerClient = blobServiceClient.getContainerClient(containerName);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        return blockBlobClient.url;
    } catch (error) {
        console.error(`Error getting file URL: ${error.message}`);
        throw error;
    }
};

const createContainer = async (containerName, accessLevel = null) => {
    try {
        const containerClient = blobServiceClient.getContainerClient(containerName);
        const options = accessLevel ? { access: accessLevel } : {};
        const createContainerResponse = await containerClient.create(options);
        return { success: true, containerName, response: createContainerResponse };
    } catch (error) {
        console.error(`Error creating container: ${error.message}`);
        throw error;
    }
};

const containerExists = async (containerName) => {
    try {
        const containerClient = blobServiceClient.getContainerClient(containerName);
        return await containerClient.exists();
    } catch (error) {
        console.error(`Error checking container existence: ${error.message}`);
        throw error;
    }
};

const createDirectory = async (containerName, directoryName) => {
    try {
        const containerClient = blobServiceClient.getContainerClient(containerName);
        const blockBlobClient = containerClient.getBlockBlobClient(`${directoryName}/.keep`);
        await blockBlobClient.upload('', 0);
        return { success: true, directoryPath: directoryName };
    } catch (error) {
        console.error(`Error creating directory: ${error.message}`);
        throw error;
    }
};

const sanitizeMetadataValue = (value) => {
    if (!value) return '';
    
    return Buffer.from(value, 'utf8').toString('base64');
};

const deserializeMetadataValue = (value) => {
    if (!value) return '';
    
    try {
        return Buffer.from(value, 'base64').toString('utf8');
    } catch (error) {
        return value;
    }
};

const uploadFileToDirectory = async (containerName, directoryName, fileName, content, contentType = null, originalFileName = null) => {
    try {
        const fullPath = `${directoryName}/${fileName}`;
        const containerClient = blobServiceClient.getContainerClient(containerName);
        const blockBlobClient = containerClient.getBlockBlobClient(fullPath);

        const contentBuffer = Buffer.from(content, 'base64');

        const options = {
            blobHTTPHeaders: {
                blobContentType: contentType || 'application/octet-stream'
            },
            metadata: {
                originalFileName: sanitizeMetadataValue(originalFileName || fileName),
                uploadedAt: new Date().toISOString(),
                fileType: 'attachment'
            }
        };

        const uploadResponse = await blockBlobClient.upload(contentBuffer, contentBuffer.length, options);
        return { success: true, filePath: fullPath, response: uploadResponse };
    } catch (error) {
        console.error(`Error uploading file to directory: ${error.message}`);
        throw error;
    }
};

const getFileAsBase64 = async (containerName, directoryName, fileName) => {
    try {
        const containerClient = blobServiceClient.getContainerClient(containerName);
        const fullPath = `${directoryName}/${fileName}`;
        const blockBlobClient = containerClient.getBlockBlobClient(fullPath);

        const exists = await blockBlobClient.exists();
        if (!exists) {
            throw new Error(`File ${fileName} not found in directory ${directoryName}`);
        }

        const downloadResponse = await blockBlobClient.downloadToBuffer();
        const base64String = downloadResponse.toString('base64');

        if (fileName.toLowerCase().endsWith('.pdf')) {
            return `data:application/pdf;base64,${base64String}`;
        }

        return base64String;
    } catch (error) {
        console.error('Error getting file as base64:', error);
        throw error;
    }
};

const getFileMetadata = async (containerName, blobName) => {
    try {
        const containerClient = blobServiceClient.getContainerClient(containerName);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        const properties = await blockBlobClient.getProperties();
        return {
            contentType: properties.contentType,
            contentLength: properties.contentLength,
            contentEncoding: properties.contentEncoding,
            lastModified: properties.lastModified,
            metadata: properties.metadata
        };
    } catch (error) {
        console.error(`Error getting file metadata: ${error.message}`);
        throw error;
    }
};

const findFileInDirectory = async (containerName, filePath) => {
    try {
        const containerClient = blobServiceClient.getContainerClient(containerName);
        const blockBlobClient = containerClient.getBlockBlobClient(filePath);
        const exists = await blockBlobClient.exists();

        if (exists) {
            const properties = await blockBlobClient.getProperties();
            return {
                exists: true,
                path: filePath,
                properties: properties
            };
        }
        return { exists: false };
    } catch (error) {
        console.error(`Error finding file in directory: ${error.message}`);
        throw error;
    }
};

const findFileInContainer = async (containerName, fileName) => {
    try {
        const containerClient = blobServiceClient.getContainerClient(containerName);
        const matches = [];

        for await (const blob of containerClient.listBlobsFlat()) {
            if (blob.name.endsWith(fileName)) {
                const properties = await containerClient
                    .getBlobClient(blob.name)
                    .getProperties();
                matches.push({
                    name: fileName,
                    path: blob.name,
                    properties: properties
                });
            }
        }

        return matches;
    } catch (error) {
        console.error(`Error finding file in container: ${error.message}`);
        throw error;
    }
};

const getFileUrlWithSAS = async (containerName, blobName) => {
    try {
        const containerClient = blobServiceClient.getContainerClient(containerName);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        const sasToken = await blockBlobClient.generateSasUrl({
            permissions: BlobSASPermissions.from({ read: true }),
            startsOn: new Date(),
            expiresOn: new Date(new Date().valueOf() + 24 * 3600 * 1000), 
        });

        return sasToken;
    } catch (error) {
        console.error(`Error getting file URL with SAS: ${error.message}`);
        throw error;
    }
};

const listDirectories = async (containerName) => {
    try {
        const containerClient = blobServiceClient.getContainerClient(containerName);
        const directories = new Set();

        for await (const blob of containerClient.listBlobsFlat()) {
            const path = blob.name.split('/');
            if (path.length > 1) {
                directories.add(path[0]);
            }
        }

        return Array.from(directories);
    } catch (error) {
        console.error(`Error listing directories: ${error.message}`);
        throw error;
    }
};

const listFilesInDirectory = async (containerName, directory) => {
    try {
        const containerClient = blobServiceClient.getContainerClient(containerName);
        const files = [];

        const prefix = directory.endsWith('/') ? directory : `${directory}/`;

        for await (const blob of containerClient.listBlobsFlat({ prefix, includeMetadata: true })) {
            if (!blob.name.endsWith('/.keep')) {
                const originalFileName = blob.metadata?.originalFileName 
                    ? deserializeMetadataValue(blob.metadata.originalFileName)
                    : blob.name.split('/').pop();
                
                files.push({
                    name: originalFileName,
                    actualName: blob.name.split('/').pop(),
                    path: blob.name,
                    size: blob.properties.contentLength,
                    lastModified: blob.properties.lastModified,
                    contentType: blob.properties.contentType,
                    originalFileName: originalFileName,
                    uploadedAt: blob.metadata?.uploadedAt,
                    fileType: blob.metadata?.fileType || 'unknown'
                });
            }
        }

        return files;
    } catch (error) {
        console.error(`Error listing files in directory: ${error.message}`);
        throw error;
    }
};

const saveFileInOrder = async (fileName, fileContent, contentType, containerName, directoryName) => {
    try {
        const exists = await containerExists(containerName);
        if (!exists) {
            await createContainer(containerName);
        }

        await createDirectory(containerName, directoryName);

        const result = await uploadFileToDirectory(
            containerName,
            directoryName,
            fileName,
            fileContent,
            contentType
        );

        return {
            success: true,
            filePath: result.filePath
        };
    } catch (error) {
        console.error('שגיאה בשמירת הקובץ:', error);
        throw error;
    }
};

const cleanupCloudStorage = async (containerName, filePath) => {
    try {
        const containerClient = blobServiceClient.getContainerClient(containerName);
        const blobClient = containerClient.getBlockBlobClient(filePath);
        const exists = await blobClient.exists();

        if (!exists) {
            return {
                success: false,
                message: `הקובץ ${filePath} לא נמצא בקונטיינר ${containerName}`
            };
        }

        await blobClient.delete();

        return {
            success: true,
            message: `הקובץ ${filePath} נמחק בהצלחה`,
            deletedPath: filePath
        };
    } catch (error) {
        console.error(`שגיאה במחיקת הקובץ: ${error.message}`);
        throw error;
    }
};

const generateDownloadUrl = async (containerName, blobName, expiryHours = 24) => {
    try {
        const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
        const containerClient = blobServiceClient.getContainerClient(containerName);
        const blobClient = containerClient.getBlobClient(blobName);

        const startsOn = new Date();
        const expiresOn = new Date(startsOn.getTime() + (expiryHours * 60 * 60 * 1000));

        const sasOptions = {
            containerName,
            blobName,
            permissions: BlobSASPermissions.parse("r"), 
            startsOn,
            expiresOn
        };

        const sasUrl = await blobClient.generateSasUrl(sasOptions);
        return sasUrl;
    } catch (error) {
        console.error('Error generating SAS URL:', error);
        throw error;
    }
};



module.exports = {
    uploadBase64File,
    downloadFile,
    listFiles,
    deleteFile,
    getFileUrl,
    createContainer,
    containerExists,
    createDirectory,
    uploadFileToDirectory,
    findFileInDirectory,
    findFileInContainer,
    listDirectories,
    listFilesInDirectory,
    saveFileInOrder,
    cleanupCloudStorage,
    getFileUrlWithSAS,
    getFileAsBase64,
    generateDownloadUrl,
};