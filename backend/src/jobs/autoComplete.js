import { autoCompleteDue } from '../services/orderWorkflow.js';

const HOUR = 60 * 60 * 1000;
let running = false;

/** One pass, never two at once in this process. */
export async function runAutoComplete(now = new Date()) {
  if (running) return { skipped: 'already running' };
  running = true;
  try {
    const result = await autoCompleteDue(now);
    if (result.completed) console.log(`[auto-complete] closed ${result.completed} order line(s)`);
    return result;
  } catch (err) {
    console.error('[auto-complete] failed:', err.message);
    return { error: err.message };
  } finally {
    running = false;
  }
}

/** On start, then hourly. unref() so it never keeps the process alive. */
export function startAutoCompleteSchedule() {
  runAutoComplete();
  setInterval(runAutoComplete, HOUR).unref();
}
