class GoogleDriveService {
  constructor() {
    this.auth = new google.auth.GoogleAuth({
      credentials: {
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN
      },
      scopes: ['https://www.googleapis.com/auth/drive']
    });
    
    this.drive = google.drive({ version: 'v3', auth: this.auth });
  }

  async createBatchFolder(batchName) {
    try {
      const folder = await this.drive.files.create({
        resource: {
          name: batchName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [process.env.MAIN_COURSES_FOLDER_ID || 'root']
        }
      });

      // Set folder permissions for platform access only
      await this.drive.permissions.create({
        fileId: folder.data.id,
        resource: {
          role: 'reader',
          type: 'anyone'
        }
      });

      return folder.data.id;
    } catch (error) {
      console.error('Drive folder creation error:', error);
      throw new Error('Failed to create batch folder');
    }
  }

  async uploadSessionMaterial(batchFolderId, fileName, fileContent, mimeType) {
    try {
      const file = await this.drive.files.create({
        resource: {
          name: fileName,
          parents: [batchFolderId]
        },
        media: {
          mimeType: mimeType,
          body: fileContent
        }
      });

      // Get shareable link
      const fileData = await this.drive.files.get({
        fileId: file.data.id,
        fields: 'webViewLink, webContentLink'
      });

      return {
        file_id: file.data.id,
        web_view_link: fileData.data.webViewLink,
        download_link: fileData.data.webContentLink
      };
    } catch (error) {
      console.error('Drive upload error:', error);
      throw new Error('Failed to upload session material');
    }
  }
}
