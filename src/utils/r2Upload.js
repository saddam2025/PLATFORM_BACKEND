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

function validateAssignmentFile(file) {
  if (!file?.buffer || !Buffer.isBuffer(file.buffer)) throw uploadError('Assignment file is required');
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_ASSIGNMENT_FILE_SIZE || file.buffer.length > MAX_ASSIGNMENT_FILE_SIZE) {
    throw uploadError('Assignment file must be 10MB or smaller');
  }

  const fileType = FILE_TYPES[file.mimetype];
  if (!fileType || !fileType.signature(file.buffer)) {
    throw uploadError('Assignment file content does not match an allowed PDF, Word, JPEG, PNG, or WebP type');
  }
  return fileType;
}

async function uploadAssignmentFile(file) {
  const fileType = validateAssignmentFile(file);
  const config = getR2Config();
  const key = `assignments/${new Date().toISOString().slice(0, 10).replace(/-/g, '/')}/${crypto.randomUUID()}.${fileType.extension}`;
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
      ContentType: file.mimetype,
      ContentDisposition: 'inline'
    }));
  } catch (err) {
    // Keep provider details and credentials out of API responses.
    console.error(`R2 assignment upload failed: ${err.name || 'unknown error'}`);
    throw uploadError('Could not upload assignment file', 502);
  }

  return `${config.publicUrlBase}/${key}`;
}

module.exports = { MAX_ASSIGNMENT_FILE_SIZE, uploadAssignmentFile, validateAssignmentFile };
