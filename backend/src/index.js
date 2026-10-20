import dotenv from 'dotenv';
dotenv.config();
import http from 'http';
import mongoose from 'mongoose';
import app, { corsOrigin } from './app.js';
import { startAutoCompleteSchedule } from './jobs/autoComplete.js';

export { corsOrigin };

const port = process.env.PORT || 3000;

// ====================== MONGO DB ======================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('🚀 MongoDB connected successfully');
    // Closes orders 7 days after delivery once nothing is open on them: now,
    // then every hour while the server is up. A free host that sleeps misses
    // some hours, so a GitHub Actions schedule also calls /api/jobs (see
    // DEPLOYMENT.md). Running it twice is harmless.
    startAutoCompleteSchedule();
  })
  .catch(err => console.error('❌ MongoDB connection error:', err));

// ====================== SERVER ======================
const server = http.createServer(app);

/**
 * Without this, a busy port throws an unhandled 'error' event: eight lines of
 * Node internals for a problem whose fix is one command. It happens often - a
 * previous run left behind, or two people starting the server at once.
 */
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error(`❌ Port ${port} is already in use.`);
    console.error('   Something else is serving on it, most likely an older');
    console.error('   run of this server that never stopped.');
    console.error('');
    console.error(`   Find it:  netstat -ano | findstr :${port}`);
    console.error('             taskkill /PID <pid> /F');
    console.error(`   Or:       npx kill-port ${port}`);
    console.error('');
    console.error('   Or serve somewhere else: set PORT in backend/.env');
    console.error('');
    process.exit(1);
  }

  if (err.code === 'EACCES') {
    console.error('');
    console.error(`❌ Not allowed to listen on port ${port}.`);
    console.error('   Ports below 1024 need admin rights. Pick a higher one');
    console.error('   with PORT in backend/.env');
    console.error('');
    process.exit(1);
  }

  console.error('❌ Server could not start:', err);
  process.exit(1);
});

// Last line of defence: a rejected promise nobody awaited is logged, not
// allowed to take every other user's requests down with the process.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

server.listen(port, () => {
  console.log("✅ Server is running");
  console.log("ENV CHECK:", {
    PORT: process.env.PORT,
    JWT: process.env.JWT_SECRET ? 'SET' : 'NOT SET',
    MONGO: process.env.MONGODB_URI ? 'SET' : 'NOT SET'
  });
});
