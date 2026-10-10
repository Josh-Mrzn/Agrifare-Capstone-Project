import crypto from 'crypto';
import multer from 'multer';
import mongoose from 'mongoose';
import path from 'path';

/**
 * Uploads are kept in the database (GridFS), not on the server's disk: free
 * hosts like Render wipe the disk on every restart and deploy, which would
 * take every photo and receipt with it.
 *
 * Anything a buyer is meant to see (product photos, farm photos, avatars) goes
 * to the "media" bucket, served at /uploads/media/<name>.
 *
 * Credentials — BIR certificates, permits, payment QR codes — and payment
 * receipts go to the "private" bucket. They are only readable through the
 * authenticated /api/files route, which checks who is asking.
 *
 * ponytail: GridFS shares the database's storage (512 MB on Atlas's free
 * tier). Move to object storage (S3, R2, Cloudinary) if uploads outgrow it.
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

const bucket = (name) =>
  new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: name });

const bucketFor = (field) => (PRIVATE_FIELDS.has(field) ? 'private' : 'media');

/** A multer storage engine that streams each upload into its GridFS bucket. */
const storage = {
  _handleFile(req, file, cb) {
    // Random name, not the original: a predictable filename is a guessable URL,
    // and the original name often leaks what the document is.
    const ext = extensionFor(file.fieldname, file);
    const filename = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`;
    const out = bucket(bucketFor(file.fieldname)).openUploadStream(filename, {
      metadata: { contentType: EXTENSION_TYPES[ext] },
    });

    let settled = false;
    const done = (err, info) => {
      if (settled) return;
      settled = true;
      cb(err, info);
    };
    file.stream.on('error', done);
    out.on('error', done);
    out.on('finish', () => done(null, { filename, id: out.id, size: out.length }));
    file.stream.pipe(out);
  },

  _removeFile(req, file, cb) {
    if (!file.id) return cb(null);
    bucket(bucketFor(file.fieldname)).delete(file.id).then(() => cb(null), cb);
  },
};

/** A stored upload's record, or null. `kind` is "media" or "private". */
export async function findStored(kind, filename) {
  const [file] = await bucket(kind).find({ filename }).limit(1).toArray();
  return file || null;
}

/** Streams a stored upload found with findStored. */
export function sendStored(kind, file, res, cacheControl) {
  res.set({
    'Content-Type': file.metadata?.contentType || 'application/octet-stream',
    'Content-Length': String(file.length),
    // Served as what the extension says, never sniffed into something else.
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': cacheControl,
  });
  bucket(kind).openDownloadStream(file._id).on('error', () => res.destroy()).pipe(res);
}

const multerUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024 },
});

/** Every file multer stored for this request, whichever method it used. */
const uploadedFiles = (req) => {
  if (req.file) return [req.file];
  if (Array.isArray(req.files)) return req.files;
  if (req.files) return Object.values(req.files).flat();
  return [];
};

/**
 * Files are written before the handler validates anything, so a rejected
 * checkout or profile edit would leave its receipt or photo in the database
 * forever, and every retry would add another. When the response is an error,
 * the request's uploads go with it.
 */
export function discardOnFailure(req, res, next) {
  res.on('finish', () => {
    if (res.statusCode < 400) return;
    for (const file of uploadedFiles(req)) {
      if (!file.id) continue;
      bucket(bucketFor(file.fieldname)).delete(file.id).catch((err) => {
        console.error('[upload] could not remove a rejected upload:', err.message);
      });
    }
  });
  next();
}

/** multer, with discardOnFailure in front of each of its middlewares. */
const upload = {
  single: (...args) => [discardOnFailure, multerUpload.single(...args)],
  array: (...args) => [discardOnFailure, multerUpload.array(...args)],
  fields: (...args) => [discardOnFailure, multerUpload.fields(...args)],
  none: (...args) => [discardOnFailure, multerUpload.none(...args)],
};

export default upload;
