/**
 * Bring Your Own Storage (BYOS) Integration - S3 Compatible Cloud Storage Client
 * Supports dynamic loading of @aws-sdk/client-s3 to keep dependencies lightweight and prevent compile crashes.
 */

/**
 * Checks if S3 Configurations are fully provided
 * @param {object} storageConfigs - User's S3 storage configuration
 * @returns {boolean} True if S3 configs are valid
 */
export function isS3ConfigValid(storageConfigs) {
  return !!(
    storageConfigs &&
    storageConfigs.bucketName &&
    storageConfigs.accessKeyId &&
    storageConfigs.secretAccessKey
  );
}

/**
 * Uploads a file buffer directly to the user's personal S3 bucket
 * @param {Buffer} fileBuffer - The file contents as a buffer
 * @param {string} key - The S3 object key (destination path in the bucket)
 * @param {string} mimeType - The file MIME type (e.g. 'image/jpeg', 'application/pdf')
 * @param {object} storageConfigs - User's S3 storage configuration
 * @returns {Promise<string>} The public access URL of the uploaded file
 */
export async function uploadToUserS3(fileBuffer, key, mimeType, storageConfigs) {
  if (!isS3ConfigValid(storageConfigs)) {
    throw new Error('Cấu hình S3 Cloud Storage chưa đầy đủ hoặc không hợp lệ.');
  }

  let S3Client, PutObjectCommand;
  try {
    // Dynamic import to keep project footprint small and robust
    const awsSdk = await import('@aws-sdk/client-s3');
    S3Client = awsSdk.S3Client;
    PutObjectCommand = awsSdk.PutObjectCommand;
  } catch (error) {
    console.error('[S3 BYOS] AWS SDK not found:', error);
    throw new Error(
      'Thư viện S3 client (@aws-sdk/client-s3) chưa được cài đặt trên máy chủ. ' +
      'Vui lòng chạy lệnh "npm install @aws-sdk/client-s3" để kích hoạt tính năng lưu trữ đám mây cá nhân.'
    );
  }

  const region = storageConfigs.region || 'us-east-1';
  
  // Clean endpoint
  let endpoint = storageConfigs.endpoint ? storageConfigs.endpoint.trim() : undefined;
  if (endpoint && !endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    endpoint = `https://${endpoint}`;
  }

  const s3Client = new S3Client({
    endpoint: endpoint || undefined,
    region: region,
    credentials: {
      accessKeyId: storageConfigs.accessKeyId.trim(),
      secretAccessKey: storageConfigs.secretAccessKey.trim()
    },
    // Required true for custom S3 providers like MinIO, Supabase, DigitalOcean Spaces, etc.
    forcePathStyle: !!endpoint
  });

  // Upload command
  const uploadParams = {
    Bucket: storageConfigs.bucketName.trim(),
    Key: key,
    Body: fileBuffer,
    ContentType: mimeType
  };

  console.log(`[S3 BYOS] Attempting upload to bucket "${storageConfigs.bucketName}" at key: "${key}"...`);

  try {
    // Attempt standard upload (some providers don't support ACLs, so we exclude it by default to avoid errors)
    const command = new PutObjectCommand(uploadParams);
    await s3Client.send(command);
    
    // Resolve public CDN URL
    let publicUrl = '';
    if (endpoint) {
      const cleanEndpoint = endpoint.replace(/\/+$/, '');
      publicUrl = `${cleanEndpoint}/${storageConfigs.bucketName.trim()}/${key}`;
    } else {
      publicUrl = `https://${storageConfigs.bucketName.trim()}.s3.${region}.amazonaws.com/${key}`;
    }

    console.log(`[S3 BYOS] Upload success! Public URL resolved: ${publicUrl}`);
    return publicUrl;
  } catch (err) {
    console.error('[S3 BYOS] Upload failed:', err.message);
    throw new Error(`Tải tệp lên Cloud Storage thất bại: ${err.message}`);
  }
}

/**
 * Tests connection to S3 by writing and deleting a temporary test file
 * @param {object} storageConfigs - User's S3 storage configuration
 * @returns {Promise<boolean>} True if connection test passed
 */
export async function testS3Connection(storageConfigs) {
  if (!isS3ConfigValid(storageConfigs)) {
    throw new Error('Thông tin cấu hình S3 chưa đầy đủ.');
  }

  let S3Client, PutObjectCommand, DeleteObjectCommand;
  try {
    const awsSdk = await import('@aws-sdk/client-s3');
    S3Client = awsSdk.S3Client;
    PutObjectCommand = awsSdk.PutObjectCommand;
    DeleteObjectCommand = awsSdk.DeleteObjectCommand;
  } catch (error) {
    throw new Error('Vui lòng cài đặt thư viện AWS SDK: npm install @aws-sdk/client-s3');
  }

  const region = storageConfigs.region || 'us-east-1';
  let endpoint = storageConfigs.endpoint ? storageConfigs.endpoint.trim() : undefined;
  if (endpoint && !endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    endpoint = `https://${endpoint}`;
  }

  const s3Client = new S3Client({
    endpoint: endpoint || undefined,
    region: region,
    credentials: {
      accessKeyId: storageConfigs.accessKeyId.trim(),
      secretAccessKey: storageConfigs.secretAccessKey.trim()
    },
    forcePathStyle: !!endpoint
  });

  const testKey = `manga2novel_test_connection_${Date.now()}.txt`;
  
  try {
    // 1. Upload test file
    await s3Client.send(new PutObjectCommand({
      Bucket: storageConfigs.bucketName.trim(),
      Key: testKey,
      Body: Buffer.from('MangaScribe AI Connection Test File'),
      ContentType: 'text/plain'
    }));

    // 2. Delete test file immediately
    await s3Client.send(new DeleteObjectCommand({
      Bucket: storageConfigs.bucketName.trim(),
      Key: testKey
    }));

    return true;
  } catch (err) {
    console.error('[S3 BYOS] Connection test failed:', err);
    throw new Error(`Lỗi kết nối S3: ${err.message}`);
  }
}
