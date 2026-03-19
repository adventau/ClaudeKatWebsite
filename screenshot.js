/**
 * Local visual testing script — takes screenshots of every theme
 * Run: node screenshot.js
 * Output: /tmp/theme-*.png
 */
const { chromium } = require('playwright');

const THEMES = ['dark', 'light', 'kathrine', 'royal', 'kaliph', 'heaven', 'rosewood', 'ocean', 'forest', 'neon', 'noir', 'arctic', 'aurora', 'sandstone'];
const BASE = 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  // Step 1: site password
  await page.goto(BASE + '/');
  await page.waitForTimeout(1000);
  const pwInput = await page.$('input[type="password"]');
  if (pwInput) {
    await pwInput.fill('KaiKat2024!');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
  }

  // Step 2: select kaliph profile
  const profileBtn = await page.$('[data-profile="kaliph"], .profile-card');
  if (profileBtn) {
    await profileBtn.click();
    await page.waitForTimeout(1000);
  }

  // Step 3: go to app
  await page.goto(BASE + '/app.html');
  await page.waitForTimeout(2500);

  for (const theme of THEMES) {
    await page.evaluate((t) => { if (typeof applyTheme === 'function') applyTheme(t); }, theme);
    await page.waitForTimeout(700);
    const file = `/tmp/theme-${theme}.png`;
    await page.screenshot({ path: file });
    console.log(`✓ ${theme} → ${file}`);
  }

  await browser.close();
  console.log('\nDone. Screenshots in /tmp/theme-*.png');
})();
