// seeder.js
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

// Never written down here: a password in the repository is a password
// everyone with the code knows. Pass it when running the seeder:
//   SEED_SUPERADMIN_PASSWORD='...' node src/scripts/seeder.js
const password = process.env.SEED_SUPERADMIN_PASSWORD;

const seedSuperAdmin = async () => {
  if (!password || password.length < 8) {
    console.error('Set SEED_SUPERADMIN_PASSWORD (at least 8 characters) to run the seeder.');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI);

    const adminExists = await User.findOne({ email: 'dev@agrifair.com' });
    if (adminExists) {
      console.log('SuperAdmin with this email already exists!');
      process.exit();
    }

    // 1. Get the highest current userId to ensure the seeder follows the increment rule
    const users = await User.find().sort({ userId: -1 }).limit(1);
    const nextId = users.length > 0 ? users[0].userId + 1 : 1;

    const superAdmin = new User({
      userId: nextId,      // ✅ Assigning the simple integer ID
      name: 'SuperAdmin',
      email: 'dev@agrifair.com',
      password,
      emailVerified: true,
      role: 'superadmin',
      status: 'active'
    });

    await superAdmin.save();
    console.log(`SuperAdmin created successfully with userId: ${nextId}`);
    process.exit();
  } catch (error) {
    console.error('Error seeding SuperAdmin:', error);
    process.exit(1);
  }
};

seedSuperAdmin();