import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';
import User from '../models/User.js';

/**
 * One-time move off Firebase Auth. Run it ONCE against the live database,
 * BEFORE deploying the version of the backend that no longer uses Firebase.
 *
 *   npm i --no-save firebase-admin
 *   FIREBASE_SERVICE_ACCOUNT='<service account json>' node src/scripts/syncFromFirebase.js
 *   ... check the printed list, then the same command with --apply
 *
 * (FIREBASE_CREDENTIALS_PATH=<path to the json file> works instead of
 * FIREBASE_SERVICE_ACCOUNT.)
 *
 * Why it is needed: sign-in used to copy `emailVerified` from Firebase into
 * Mongo, but only at sign-in. Anyone who clicked the Firebase link and has not
 * signed in since is still unverified in Mongo, and would be locked out.
 *
 * It also marks verified the accounts that never had a Firebase user - the
 * seeded superadmin and accounts a Super Admin created. Sign-in used to skip
 * the email check for them; from now on every account needs the flag.
 *
 * Passwords need nothing: every password change already wrote the bcrypt hash
 * in Mongo as well, and that hash is now the only one checked.
 *
 * Without --apply it changes nothing and only prints what it would do.
 */

const apply = process.argv.includes('--apply');

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (raw) return JSON.parse(raw);
  const file = process.env.FIREBASE_CREDENTIALS_PATH;
  if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  throw new Error('Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_CREDENTIALS_PATH.');
}

let firebaseAdmin;
try {
  firebaseAdmin = {
    app: await import('firebase-admin/app'),
    auth: await import('firebase-admin/auth'),
  };
} catch {
  console.error('firebase-admin is not installed. Run: npm i --no-save firebase-admin');
  process.exit(1);
}

const serviceAccount = loadServiceAccount();
const app = firebaseAdmin.app.initializeApp({
  credential: firebaseAdmin.app.cert(serviceAccount),
  projectId: serviceAccount.project_id,
});
const auth = firebaseAdmin.auth.getAuth(app);

await mongoose.connect(process.env.MONGODB_URI);

const unverified = await User.find({ emailVerified: { $ne: true } })
  .select('userId email role status firebaseUid passwordSet');

let fromFirebase = 0;
let noFirebaseUser = 0;

for (const user of unverified) {
  let verify = false;
  let reason = '';

  if (user.firebaseUid) {
    try {
      const fbUser = await auth.getUser(user.firebaseUid);
      if (fbUser.emailVerified) {
        verify = true;
        reason = 'verified in Firebase';
      }
    } catch (err) {
      console.warn(`  ! ${user.email}: could not read Firebase user (${err.code || err.message})`);
    }
  } else if (user.passwordSet !== false) {
    // No Firebase user at all: seeded or created by a Super Admin. A rider who
    // has not activated yet (passwordSet false) is left alone - activation
    // verifies them.
    verify = true;
    reason = 'no Firebase user (seeded or created by a Super Admin)';
  }

  if (!verify) continue;

  console.log(`  ${apply ? 'verified' : 'would verify'}  #${user.userId} ${user.email} (${user.role}) - ${reason}`);
  if (user.firebaseUid) fromFirebase += 1;
  else noFirebaseUser += 1;

  if (apply) {
    await User.updateOne({ _id: user._id }, { $set: { emailVerified: true } });
  }
}

console.log('');
console.log(`${unverified.length} unverified accounts checked.`);
console.log(`${fromFirebase} verified in Firebase, ${noFirebaseUser} with no Firebase user.`);
if (!apply) console.log('Nothing was changed. Run again with --apply to write it.');

await mongoose.disconnect();
