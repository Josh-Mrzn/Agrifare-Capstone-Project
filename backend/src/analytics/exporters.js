import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { TZ_OFFSET_MS } from './period.js';

/**
 * Writes a report (see reports.js) as CSV, XLSX or PDF.
 *
 * Values are kept raw until the last step: the spreadsheet gets real numbers
 * and dates with a display format, the CSV gets plain machine-readable
 * values, and only the PDF turns them into formatted text.
 */

/** Manila date-time, YYYY-MM-DD HH:MM. */
export function manilaStamp(date, withTime = true) {
  const d = new Date(new Date(date).getTime() + TZ_OFFSET_MS).toISOString();
  return withTime ? `${d.slice(0, 10)} ${d.slice(11, 16)}` : d.slice(0, 10);
}

/**
 * Spreadsheet formula injection: a cell that starts with = + - @ (or a tab or
 * carriage return) is run as a formula by Excel and Sheets. Text from users -
 * buyer names, product names, notes - gets a leading apostrophe so it is shown
 * as text. Numbers are written as numbers and need no guard.
 */
export function safeText(value) {
  const str = value == null ? '' : String(value);
  return /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
}

const csvCell = (value) => {
  const str = String(value);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

function csvValue(col, value) {
  if (value == null || value === '') return '';
  switch (col.type) {
    case 'money': return Number(value).toFixed(2);
    case 'number':
    case 'kg':
    case 'percent': return String(Math.round(Number(value) * 100) / 100);
    case 'date': return manilaStamp(value);
    default: return safeText(value);
  }
}

/** The main table only, with a header row; a byte-order mark so Excel reads UTF-8. */
export function toCsv(report) {
  const section = report.sections[0];
  const header = section.columns.map((c) => csvCell(c.label)).join(',');
  const lines = section.rows.map((row) => section.columns.map((c) => csvCell(csvValue(c, row[c.key]))).join(','));
  return Buffer.from(`﻿${[header, ...lines].join('\r\n')}\r\n`, 'utf8');
}

const XLSX_FORMATS = {
  money: '"₱"#,##0.00',
  number: '#,##0.##',
  kg: '#,##0.## "kg"',
  percent: '0.0"%"',
  date: 'yyyy-mm-dd hh:mm',
};

/** A summary sheet, then one sheet per section with typed, formatted columns. */
export async function toXlsx(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AgriFair';
  wb.created = report.generatedAt;

  const info = wb.addWorksheet('Summary');
  info.columns = [{ width: 32 }, { width: 48 }];
  info.addRow([report.title]).font = { bold: true, size: 14 };
  info.addRow(['Reporting period', `${report.period.from} to ${report.period.to} (Philippine time)`]);
  info.addRow(['Generated', manilaStamp(report.generatedAt)]);
  info.addRow(['Currency', 'Philippine peso (PHP)']);
  info.addRow([]);
  for (const s of report.summary || []) info.addRow([s.label, s.value]);
  if (report.notes?.length) {
    info.addRow([]);
    for (const n of report.notes) info.addRow(['Note', n]);
  }

  for (const section of report.sections) {
    // Sheet names: 31 characters, none of []:*?/\
    const name = section.title.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31);
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = section.columns.map((c) => ({
      header: c.label,
      key: c.key,
      width: Math.max(10, Math.min(40, Math.round((c.width || 60) / 4.5))),
      style: XLSX_FORMATS[c.type] ? { numFmt: XLSX_FORMATS[c.type] } : {},
    }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F2E6' } };
    for (const row of section.rows) {
      const out = {};
      for (const c of section.columns) {
        const v = row[c.key];
        if (v == null || v === '') out[c.key] = null;
        else if (c.type === 'date') out[c.key] = new Date(new Date(v).getTime() + TZ_OFFSET_MS); // shown in Manila time
        else if (['money', 'number', 'kg', 'percent'].includes(c.type)) out[c.key] = Number(v);
        else out[c.key] = safeText(v);
      }
      ws.addRow(out);
    }
    if (section.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: section.columns.length } };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------- PDF

const INK = '#1a2e1a';
const SOFT = '#6b7268';
const LINE = '#e2e0d8';
const FOREST = '#1c3a1c';
const LEAF = '#2d5a2d';
const CREAM = '#f6f4ee';
const GOLD = '#c9a84c';
const MARGIN = 40;

const pdfMoney = (n) => `PHP ${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function pdfValue(col, value) {
  if (value == null || value === '') return '—';
  switch (col.type) {
    case 'money': return pdfMoney(value);
    case 'kg': return `${Number(value).toLocaleString('en-PH', { maximumFractionDigits: 1 })} kg`;
    case 'number': return Number(value).toLocaleString('en-PH', { maximumFractionDigits: 1 });
    case 'percent': return `${Number(value).toLocaleString('en-PH', { maximumFractionDigits: 1 })}%`;
    case 'date': return manilaStamp(value, false);
    default: return String(value);
  }
}

/** A landscape A4 report: masthead, summary tiles, one chart, tables, notes. */
export function toPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: MARGIN, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - MARGIN * 2;
    const bottom = () => doc.page.height - MARGIN - 24;

    doc.rect(0, 0, doc.page.width, 70).fill(FOREST);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16).text('AgriFair', MARGIN, 20);
    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(9).text(report.title.toUpperCase(), MARGIN, 42, { characterSpacing: 1 });
    doc.fillColor('#ffffff').font('Helvetica').fontSize(8.5)
      .text(`${report.period.from} to ${report.period.to} (Philippine time)`, MARGIN, 24, { width: W, align: 'right' })
      .text(`Generated ${manilaStamp(report.generatedAt)} · Amounts in PHP`, MARGIN, 40, { width: W, align: 'right' });
    doc.y = 88;

    const summary = report.summary || [];
    if (summary.length) {
      const gap = 10;
      const w = (W - gap * (summary.length - 1)) / summary.length;
      const top = doc.y;
      summary.forEach((s, i) => {
        const x = MARGIN + i * (w + gap);
        doc.roundedRect(x, top, w, 44, 4).fill(CREAM);
        doc.fillColor(SOFT).font('Helvetica').fontSize(7).text(s.label.toUpperCase(), x + 10, top + 8, { width: w - 20, characterSpacing: 0.6 });
        doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(String(s.value).replace(/₱/g, 'PHP '), x + 10, top + 21, { width: w - 20, lineBreak: false });
      });
      doc.y = top + 58;
    }

    const chart = report.chart;
    if (chart?.points?.length) {
      const pts = chart.points.slice(0, chart.horizontal ? 10 : 40);
      const max = Math.max(...pts.map((p) => Number(p.value) || 0), 1);
      const top = doc.y;
      const h = chart.horizontal ? pts.length * 16 + 22 : 130;
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(chart.title, MARGIN, top);
      if (chart.horizontal) {
        pts.forEach((p, i) => {
          const y = top + 18 + i * 16;
          doc.fillColor(SOFT).font('Helvetica').fontSize(8).text(String(p.label), MARGIN, y + 2, { width: 120, lineBreak: false, ellipsis: true });
          const bw = ((Number(p.value) || 0) / max) * (W - 260);
          doc.rect(MARGIN + 126, y + 2, Math.max(1, bw), 9).fill(LEAF);
          doc.fillColor(INK).fontSize(8).text(pdfMoney(p.value), MARGIN + 132 + bw, y + 2, { lineBreak: false });
        });
      } else {
        const base = top + 118;
        const bw = Math.min(28, (W - 40) / pts.length - 4);
        doc.strokeColor(LINE).lineWidth(0.5).moveTo(MARGIN, base).lineTo(MARGIN + W, base).stroke();
        pts.forEach((p, i) => {
          const x = MARGIN + 4 + i * ((W - 8) / pts.length);
          const bh = ((Number(p.value) || 0) / max) * 90;
          doc.rect(x, base - bh, bw, Math.max(0.5, bh)).fill(LEAF);
          if (pts.length <= 16 || i % Math.ceil(pts.length / 12) === 0) {
            doc.fillColor(SOFT).font('Helvetica').fontSize(6.5).text(String(p.label), x - 6, base + 3, { width: bw + 12, align: 'center', lineBreak: false });
          }
        });
        doc.fillColor(SOFT).fontSize(7).text(`Highest: ${pdfMoney(max)}`, MARGIN, top + 2, { width: W, align: 'right' });
      }
      doc.y = top + h + 12;
    }

    for (const section of report.sections) {
      if (doc.y + 60 > bottom()) { doc.addPage(); doc.y = MARGIN; }
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text(section.title, MARGIN, doc.y);
      doc.y += 4;
      if (!section.rows.length) {
        doc.roundedRect(MARGIN, doc.y, W, 30, 4).fill(CREAM);
        doc.fillColor(SOFT).font('Helvetica').fontSize(8.5).text('Nothing recorded for this period and these filters.', MARGIN + 12, doc.y + 11);
        doc.y += 44;
        continue;
      }
      const total = section.columns.reduce((s, c) => s + (c.width || 60), 0);
      const cols = section.columns.map((c) => ({ ...c, w: ((c.width || 60) / total) * W }));
      const right = (c) => ['money', 'number', 'kg', 'percent'].includes(c.type);
      const header = () => {
        const top = doc.y;
        doc.rect(MARGIN, top, W, 20).fill(CREAM);
        let x = MARGIN;
        doc.fillColor(SOFT).font('Helvetica-Bold').fontSize(6.5);
        for (const c of cols) {
          doc.text(c.label.toUpperCase(), x + 5, top + 7, { width: c.w - 10, align: right(c) ? 'right' : 'left', lineBreak: false, ellipsis: true });
          x += c.w;
        }
        doc.y = top + 20;
      };
      header();
      section.rows.forEach((row, i) => {
        if (doc.y + 18 > bottom()) { doc.addPage(); doc.y = MARGIN; header(); }
        const top = doc.y;
        if (i % 2) doc.rect(MARGIN, top, W, 17).fill('#faf9f5');
        let x = MARGIN;
        doc.font('Helvetica').fontSize(7.5).fillColor('#3d453b');
        for (const c of cols) {
          doc.text(pdfValue(c, row[c.key]), x + 5, top + 5, { width: c.w - 10, align: right(c) ? 'right' : 'left', lineBreak: false, ellipsis: true });
          x += c.w;
        }
        doc.y = top + 17;
      });
      doc.y += 14;
    }

    if (report.notes?.length) {
      if (doc.y + 40 > bottom()) { doc.addPage(); doc.y = MARGIN; }
      doc.fillColor(SOFT).font('Helvetica').fontSize(7.5);
      for (const n of report.notes) doc.text(`• ${n}`, MARGIN, doc.y, { width: W });
    }

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(range.start + i);
      const y = doc.page.height - MARGIN + 6;
      doc.strokeColor(LINE).lineWidth(0.5).moveTo(MARGIN, y - 8).lineTo(doc.page.width - MARGIN, y - 8).stroke();
      doc.fillColor(SOFT).font('Helvetica').fontSize(7)
        .text(`${report.title} · Generated by AgriFair`, MARGIN, y, { lineBreak: false })
        .text(`Page ${i + 1} of ${range.count}`, MARGIN, y, { width: doc.page.width - MARGIN * 2, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}

export const FORMATS = {
  csv: { type: 'text/csv; charset=utf-8', write: async (r) => toCsv(r) },
  xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', write: toXlsx },
  pdf: { type: 'application/pdf', write: toPdf },
};
