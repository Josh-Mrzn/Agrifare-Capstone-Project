import crypto from 'crypto';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PUBLIC_DIR = path.join(__dirname, '../uploads/media');
export const PRIVATE_DIR = path.join(__dirname, '../uploads/private');

for (const dir of [PUBLIC_DIR, PRIVATE_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Anything a buyer is meant to see (product photos, farm photos, avatars) goes to
 * PUBLIC_DIR, which is served statically.
 *
 * Credentials — BIR certificates, permits, payment QR codes — and payment
 * receipts go to PRIVATE_DIR,
 * which is never served statically. They are only readable through the
 * authenticated /api/files route, which checks who is asking.
 */
const PRIVATE_FIELDS = new Set(['paymentQr', 'document', 'paymentProof', 'proof']);

/**
 * What each upload may be, and the extension it is saved with.
 *
 * The extension comes from this table, never from the uploaded name. Files in
 * uploads/media are served straight from the API's own address, so an
 * "image" saved as page.html would be a web page there - with the power to
 * act as whoever opened it.
 */
const IMAGE_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
const DOCUMENT_TYPES = { ...IMAGE_TYPES, 'application/pdf': '.pdf' };

const allowedFor = (field) => (field === 'document' ? DOCUMENT_TYPES : IMAGE_TYPES);

const EXTENSION_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

/**
 * The type a file is saved as. The phone app sends every file as
 * application/octet-stream, so for those the name's extension decides -
 * still only from the list above, so the saved name can never end in
 * anything else.
 */
function savedType(file) {
  if (file.mimetype !== 'application/octet-stream') return file.mimetype;
  return EXTENSION_TYPES[path.extname(file.originalname || '').toLowerCase()] || '';
}

/** The extension to save under, or undefined when this file is not allowed. */
export const extensionFor = (field, file) => allowedFor(field)[savedType(file)];

function fileFilter(req, file, cb) {
  if (extensionFor(file.fieldname, file)) return cb(null, true);

  const err = new Error(
    file.fieldname === 'document'
      ? 'Upload a JPG, PNG, WebP or PDF file.'
      : 'Upload a JPG, PNG or WebP image.'
  );
  err.status = 400;
  return cb(err);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, PRIVATE_FIELDS.has(file.fieldname) ? PRIVATE_DIR : PUBLIC_DIR);
  },
  filename: (req, file, cb) => {
    // Random name, not the original: a predictable filename is a guessable URL,
    // and the original name often leaks what the document is.
    const ext = extensionFor(file.fieldname, file);
    const random = crypto.randomBytes(12).toString('hex');
    cb(null, `${Date.now()}-${random}${ext}`);
  },
});

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024 },
});

export default upload;
