const multer = require('multer');
// Files that are persisted by this API are buffered only long enough for the
// controller to send them to R2. Railway's container filesystem is ephemeral.
const storage = multer.memoryStorage();

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

  if (field === 'homework' || field === 'assignment') {
    const allowedHomeworkMimes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    const allowedAssignmentMimes = [...allowedHomeworkMimes, 'image/jpeg', 'image/png', 'image/webp'];
    const allowedMimes = field === 'assignment' ? allowedAssignmentMimes : allowedHomeworkMimes;
    if (allowedMimes.includes(file.mimetype)) return cb(null, true);
    return cb(new Error(`Invalid file type for ${field} field: only ${field === 'assignment' ? 'PDF/DOC/DOCX/JPEG/PNG/WebP' : 'PDF/DOC/DOCX'} allowed`), false);
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

const assignmentMulter = multer({
  // Assignment files go straight into memory and are sent to R2 by the
  // controller. They are never written to src/uploads first.
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
});

const uploadAssignment = (req, res, next) => {
  assignmentMulter.single('assignment')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? 'Assignment file must be 10MB or smaller'
        : err.message || 'Invalid assignment upload';
      return res.status(400).json({ message });
    }
    next();
  });
};

const reelMulter = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'video' && ['video/mp4', 'video/webm'].includes(file.mimetype)) return cb(null, true);
    return cb(new Error('Reel video must be an MP4 or WebM file'), false);
  },
  limits: { fileSize: 500 * 1024 * 1024 }
});

async function hasValidReelSignature(file) {
  const buffer = file.buffer || Buffer.alloc(0);
  const isWebm = buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  const isMp4 = buffer.length >= 8 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  return (file.mimetype === 'video/webm' && isWebm) || (file.mimetype === 'video/mp4' && isMp4);
}

const uploadReelVideo = (req, res, next) => {
  reelMulter.single('video')(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.code === 'LIMIT_FILE_SIZE' ? 'Reel video must be 500MB or smaller' : err.message || 'Invalid reel upload' });
    if (!req.file) return res.status(400).json({ message: 'ملف الفيديو مطلوب' });
    try {
      if (!await hasValidReelSignature(req.file)) {
        return res.status(400).json({ message: 'محتوى ملف الفيديو لا يطابق نوع MP4 أو WebM' });
      }
      next();
    } catch (validationError) {
      next(validationError);
    }
  });
};

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

module.exports = { uploadVideo, uploadGeneral, uploadAssignment, uploadAvatar, uploadReelVideo };
