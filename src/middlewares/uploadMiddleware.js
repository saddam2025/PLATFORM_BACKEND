const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
const SUBDIRS = { video: 'videos', thumbnail: 'thumbnails', homework: 'homework', avatar: 'avatars' };

// Ensure target directories exist at startup — avoids runtime ENOENT errors
// on first upload in a fresh environment.
Object.values(SUBDIRS).forEach((dir) => {
  const fullPath = path.join(UPLOAD_ROOT, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

function destinationForField(fieldname) {
  if (fieldname === 'video') return SUBDIRS.video;
  if (fieldname === 'thumbnail') return SUBDIRS.thumbnail;
  if (fieldname === 'homework') return SUBDIRS.homework;
  if (fieldname === 'avatar') return SUBDIRS.avatar;
  return null;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const subdir = destinationForField(file.fieldname);
    if (!subdir) {
      return cb(new Error(`Unexpected upload field: ${file.fieldname}`));
    }
    cb(null, path.join(UPLOAD_ROOT, subdir));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const avatarExtensions = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp'
    };
    const ext = file.fieldname === 'avatar'
      ? avatarExtensions[file.mimetype]
      : path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  }
});

// OWASP note: never trust the file extension alone — mimetype is checked
// explicitly here, since a malicious actor can rename any file's extension.
const fileFilter = (req, file, cb) => {
  const field = file.fieldname;

  if (field === 'video') {
    if (file.mimetype.startsWith('video/')) return cb(null, true);
    return cb(new Error('Invalid file type for video field: only video/* MIME types allowed'), false);
  }

  if (field === 'thumbnail') {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    return cb(new Error('Invalid file type for thumbnail field: only image/* MIME types allowed'), false);
  }

  if (field === 'homework') {
    const allowedHomeworkMimes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (allowedHomeworkMimes.includes(file.mimetype)) return cb(null, true);
    return cb(new Error('Invalid file type for homework field: only PDF/DOC/DOCX allowed'), false);
  }

  if (field === 'avatar') {
    const allowedAvatarMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedAvatarMimes.includes(file.mimetype)) return cb(null, true);
    return cb(new Error('Invalid file type for avatar field: only JPEG, PNG, and WebP images allowed'), false);
  }

  return cb(new Error(`Unexpected upload field: ${field}`), false);
};

// Per-field size limits are enforced at the multer instance level via a
// shared max (Multer doesn't support per-field limits natively), so the
// video field gets its own dedicated instance with a higher ceiling.
const uploadVideo = multer({
  storage,
  fileFilter,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB
});

const uploadGeneral = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB — thumbnails, homework
});

const avatarMulter = multer({
  storage,
  fileFilter,
  limits: { fileSize: 3 * 1024 * 1024 }
});

// Keeps Multer-specific failures out of the generic 500 error path and
// drops unrelated multipart fields; this endpoint accepts only `avatar`.
const uploadAvatar = (req, res, next) => {
  avatarMulter.single('avatar')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? 'Avatar image must be 3MB or smaller'
        : err.message || 'Invalid avatar upload';
      return res.status(400).json({ message });
    }
    req.body = {};
    next();
  });
};

module.exports = { uploadVideo, uploadGeneral, uploadAvatar };
