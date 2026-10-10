import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';

let transporter = null;
let gmailToken = null; // { value, expiresAt }

const GMAIL_SEND_URL =
  'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

/**
 * Three ways to send, picked by what is configured (first match wins):
 *
 * - BREVO_API_KEY: Brevo's transactional email API over HTTPS (port 443), so
 *   it works on Railway. MAIL_FROM must be a sender verified in Brevo.
 * - GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN: the Gmail API
 *   over HTTPS (port 443). Use this on Railway — Railway blocks outbound SMTP
 *   (25/465/587) on non-Pro plans, so Gmail SMTP only ever times out there.
 *   Nodemailer still builds the message; only the delivery changes.
 * - SMTP_HOST/SMTP_USER/SMTP_PASS: plain SMTP, fine for local development.
 *
 * Mail is optional: the app runs fine without either, and anything that sends
 * mail reports a clear "not configured" instead of crashing.
 *
 * For Gmail SMTP, SMTP_PASS must be an App Password, not the account password —
 * Google rejects plain passwords from SMTP.
 */
function useBrevo() {
  return Boolean(process.env.BREVO_API_KEY);
}

function useGmailApi() {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env;
  return Boolean(GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET && GMAIL_REFRESH_TOKEN);
}

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export function getMailer() {
  if (transporter) return transporter;
  if (!smtpConfigured()) return null;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },

    // Without pooling, every message pays for a fresh TCP connection, TLS
    // handshake and login to Gmail - most of the several seconds a send used
    // to take. Held open, later messages skip all of it.
    pool: true,
    maxConnections: 3,

    // A hung SMTP connection must not hold a request forever.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });

  return transporter;
}

export function isMailConfigured() {
  return useBrevo() || useGmailApi() || smtpConfigured();
}

/**
 * Access tokens last about an hour; the refresh token does not expire as long
 * as the OAuth app is "In production" and the account keeps its access.
 */
async function getGmailAccessToken() {
  if (gmailToken && gmailToken.expiresAt > Date.now()) return gmailToken.value;

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Google refused the Gmail token refresh (${res.status}): ${detail}`);
  }

  const { access_token, expires_in } = await res.json();
  gmailToken = { value: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 };
  return access_token;
}

async function sendViaGmailApi(message) {
  const raw = await new MailComposer(message).compile().build();
  const token = await getGmailAccessToken();

  const res = await fetch(GMAIL_SEND_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'message/rfc822' },
    body: raw,
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    if (res.status === 401) gmailToken = null;
    const detail = await res.text().catch(() => '');
    throw new Error(`Gmail API rejected the email (${res.status}): ${detail}`);
  }

  return res.json();
}

/** "AgriFair <support@gmail.com>" -> { name: 'AgriFair', email: 'support@gmail.com' } */
function parseAddress(value) {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value || '');
  if (match) return { name: match[1].trim() || undefined, email: match[2].trim() };
  return { email: String(value || '').trim() };
}

async function sendViaBrevo({ from, to, subject, html, attachments }) {
  const res = await fetch(BREVO_SEND_URL, {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: parseAddress(from),
      to: [{ email: to }],
      subject,
      htmlContent: html,
      // Brevo takes attachments as base64 rather than nodemailer's Buffers.
      ...(attachments?.length
        ? {
            attachment: attachments.map((a) => ({
              name: a.filename,
              content: Buffer.from(a.content).toString('base64'),
            })),
          }
        : {}),
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Brevo rejected the email (${res.status}): ${detail}`);
  }

  return res.json();
}

export async function sendMail({ to, subject, html, attachments }) {
  if (!isMailConfigured()) {
    throw new Error(
      'Email is not set up. Add BREVO_API_KEY (or the GMAIL_* or SMTP_* settings) to backend/.env, then restart the server.'
    );
  }

  const from = process.env.MAIL_FROM || `AgriFair <${process.env.SMTP_USER}>`;
  const message = { from, to, subject, html, attachments };

  if (useBrevo()) return sendViaBrevo(message);
  if (useGmailApi()) return sendViaGmailApi(message);
  return getMailer().sendMail(message);
}

/**
 * sendMail, but gives up after `ms`. The phone abandons a request after 20
 * seconds, so anything a person waits on must answer before that - either
 * "sent" or a real error they can retry, never a silent background failure.
 */
export const SEND_TIMEOUT_MS = 15 * 1000;

export async function sendMailWithin(ms, message) {
  let timer;
  try {
    return await Promise.race([
      sendMail(message),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('the mail service did not answer in time')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
