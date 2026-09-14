const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const MAX_ASSIGNMENT_FILE_SIZE = 10 * 1024 * 1024;

const FILE_TYPES = {
  'application/pdf': { extension: 'pdf', signature: (buffer) => buffer.subarray(0, 5).toString('ascii') === '%PDF-' },
  'application/msword': { extension: 'doc', signature: (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { extension: 'docx', signature: (buffer) => buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) },
  'image/jpeg': { extension: 'jpg', signature: (buffer) => buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) },
  'image/png': { extension: 'png', signature: (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { extension: 'webp', signature: (buffer) => buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP' }
};

function uploadError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getR2Config() {
  const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL_BASE'];
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length) throw uploadError('R2 upload configuration is unavailable', 500);

  return {
    accountId: process.env.R2_ACCOUNT_ID.trim(),
    accessKeyId: process.env.R2_ACCESS_KEY_ID.trim(),
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY.trim(),
    bucketName: process.env.R2_BUCKET_NAME.trim(),
    publicUrlBase: process.env.R2_PUBLIC_URL_BASE.trim().replace(/\/+$/, '')
  };
}

function validateR2File(file, allowedMimeTypes = Object.keys(FILE_TYPES), maxSize = MAX_ASSIGNMENT_FILE_SIZE, label = 'File') {
  if (!file?.buffer || !Buffer.isBuffer(file.buffer)) throw uploadError(`${label} is required`);
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > maxSize || file.buffer.length > maxSize) {
    throw uploadError(`${label} must be ${Math.floor(maxSize / (1024 * 1024))}MB or smaller`);
  }

  // Browser MIME detection is inconsistent for files copied from messaging
  // apps. Trust the file's signature and store the matching MIME type instead.
  const detectedMimeType = allowedMimeTypes.find((mimeType) => FILE_TYPES[mimeType]?.signature(file.buffer));
  const fileType = detectedMimeType ? { ...FILE_TYPES[detectedMimeType], mimeType: detectedMimeType } : null;
  if (!fileType) {
    throw uploadError(`${label} content does not match an allowed file type`);
  }
  return fileType;
}

async function uploadR2File(file, { prefix, allowedMimeTypes, maxSize, label = 'File', contentDisposition = 'inline' }) {
  const fileType = validateR2File(file, allowedMimeTypes, maxSize, label);
  const config = getR2Config();
  const key = `${prefix}/${new Date().toISOString().slice(0, 10).replace(/-/g, '/')}/${crypto.randomUUID()}.${fileType.extension}`;
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
  });

  try {
    await client.send(new PutObjectCommand({
      Bucket: config.bucketName,
      Key: key,
      Body: file.buffer,
      ContentType: fileType.mimeType,
      ContentDisposition: contentDisposition
    }));
  } catch (err) {
    // Keep provider details and credentials out of API responses.
    console.error(`R2 ${prefix} upload failed: ${err.name || 'unknown error'}`);
    throw uploadError(`Could not upload ${label.toLowerCase()}`, 502);
  }

  return `${config.publicUrlBase}/${key}`;
}

function validateAssignmentFile(file) {
  return validateR2File(file, Object.keys(FILE_TYPES), MAX_ASSIGNMENT_FILE_SIZE, 'Assignment file');
}

function uploadAssignmentFile(file) {
  return uploadR2File(file, {
    prefix: 'assignments',
    allowedMimeTypes: Object.keys(FILE_TYPES),
    maxSize: MAX_ASSIGNMENT_FILE_SIZE,
    label: 'Assignment file'
  });
}

function uploadHomeworkFile(file) {
  return uploadR2File(file, {
    prefix: 'homework',
    allowedMimeTypes: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    maxSize: MAX_ASSIGNMENT_FILE_SIZE,
    label: 'Homework file'
  });
}

function uploadImageFile(file, prefix, label = 'Image') {
  return uploadR2File(file, {
    prefix,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxSize: MAX_ASSIGNMENT_FILE_SIZE,
    label
  });
}

module.exports = { MAX_ASSIGNMENT_FILE_SIZE, uploadAssignmentFile, uploadHomeworkFile, uploadImageFile, validateAssignmentFile, validateR2File };
