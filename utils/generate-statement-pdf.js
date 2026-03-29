// Budget Period Statement — PDF Generation Engine
// Uses Puppeteer with a lazy singleton browser for performance

const { buildStatementHTML } = require('./statement-template');

let _browser = null;

async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  const puppeteer = require('puppeteer');
  _browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  return _browser;
}

async function generateStatementPDF(data) {
  const html = buildStatementHTML(data);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '0', right: '0' },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}

module.exports = { generateStatementPDF };
