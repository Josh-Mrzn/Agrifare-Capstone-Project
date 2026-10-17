import { findUserByUserId } from '../repositories/userRepository.js';
import { sendMail, isMailConfigured } from '../config/mailer.js';
import { sellerReport, reportFileName, SELLER_REPORTS } from '../analytics/reports.js';
import { toPdf } from '../analytics/exporters.js';
import { escapeHtml } from '../utils/escapeHtml.js';

const shortDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

/** Short covering note; the numbers themselves live in the attached PDF. */
function mailBody(seller, heading, lines) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#1a2e1a;max-width:560px;margin:0 auto;padding:24px">
    <div style="border-bottom:3px solid #2d5a2d;padding-bottom:12px;margin-bottom:18px">
      <h1 style="margin:0;font-size:19px;color:#0f1d10">AgriFair</h1>
      <p style="margin:4px 0 0;font-size:13px;color:#6b7268">${heading}</p>
    </div>
    <p style="font-size:14px;line-height:1.6;margin:0 0 14px">
      Hi ${escapeHtml(seller.name) || 'there'}, your report is attached as a PDF.
    </p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      ${lines.map((l) => `
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#6b7268">${l.label}</td>
          <td style="padding:6px 0;font-size:13px;font-weight:bold;text-align:right">${escapeHtml(l.value)}</td>
        </tr>`).join('')}
    </table>
    <p style="font-size:12px;color:#6b7268;line-height:1.6;margin:0">
      Generated ${shortDate(new Date())}.
    </p>
    <p style="margin-top:24px;font-size:11px;color:#8a948a;border-top:1px solid #e4e4e0;padding-top:12px">
      Sent because you requested this report from your AgriFair seller dashboard.
    </p>
  </div>`;
}

// ---------------------------------------------------------------- builders

// The emailed PDF is built by the same report code as the downloads, with the
// same period and filters, so the email and the screen never disagree.
// "transactions" is the older name of the orders report.
const TYPE_ALIASES = { transactions: 'orders' };

/**
 * Emails a report as a PDF. The recipient is always the seller's own account
 * address — there is no "send to" input, so this cannot be used to mail one
 * business's figures to an outsider.
 */
export const emailReport = async (sellerId, type, query = {}) => {
  const reportType = TYPE_ALIASES[type] || type;
  if (!SELLER_REPORTS.includes(reportType)) throw new Error('Unknown report type');

  if (!isMailConfigured()) {
    throw new Error(
      'Email is not set up yet. Add BREVO_API_KEY (or the GMAIL_* or SMTP_* settings) to the server environment, then restart it.'
    );
  }

  const seller = await findUserByUserId(sellerId);
  if (!seller?.email) throw new Error('Your account has no email address on file.');

  const report = await sellerReport({ sellerId }, reportType, query);
  const pdf = await toPdf(report);

  await sendMail({
    to: seller.email,
    subject: `Your AgriFair ${report.title.toLowerCase()}`,
    html: mailBody(seller, `${report.title} · ${report.period.from} to ${report.period.to}`, report.summary),
    attachments: [{ filename: reportFileName(report, 'pdf'), content: pdf, contentType: 'application/pdf' }],
  });

  return { sent: true, to: seller.email };
};

export const mailStatus = () => ({ configured: isMailConfigured() });
