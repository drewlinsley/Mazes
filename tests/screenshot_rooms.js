// Exercises the pre-rendered MazeBench room mode of web/index.html in headless Chromium.
// usage: NODE_PATH=$(npm root -g) node tests/screenshot_rooms.js OUT_DIR
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

(async () => {
  const out = process.argv[2] || '.';
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '..', 'web', 'index.html'));
  await page.selectOption('#source', 'rooms');
  await page.waitForTimeout(100);
  const count = await page.textContent('#rooms-count');
  await page.screenshot({ path: path.join(out, 'r1-setup.png') });

  await page.fill('#task-n', '4');
  await page.fill('#task-seed', '7');
  await page.fill('#task-fix', '50');
  await page.click('#task-start');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, 'r2-trial.png') });
  const imgShown = await page.evaluate(() => { const img = document.getElementById('task-image'); return !img.hidden && img.naturalWidth > 0 && !document.getElementById('task-canvas').offsetParent; });
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(150);
    await page.keyboard.press(i % 2 ? 'j' : 'f');
    await page.waitForTimeout(1800);
  }
  await page.waitForSelector('#task-results:not([hidden])', { timeout: 10000 });
  await page.screenshot({ path: path.join(out, 'r3-results.png') });
  const summary = (await page.textContent('#task-summary')).replace(/\s+/g, ' ').trim();
  const tableHead = (await page.textContent('#task-table tr')).replace(/\s+/g, ' ').trim();

  await page.click('.tab[data-tab="explore"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'r4-explore.png'), fullPage: true });
  const caps = await page.evaluate(() => [document.getElementById('rooms-cap-a').textContent, document.getElementById('rooms-cap-b').textContent, document.getElementById('rooms-pos').textContent]);

  await page.click('.tab[data-tab="model"]');
  await page.selectOption('#model-repr', 'ascii');
  const prompt = await page.textContent('#model-prompt');
  const check = await page.evaluate(() => {
    const t = MazeApp.buildRoomTrials(4, '7');
    return { n: t.length, labels: t.map(x => x.solvable), pairs: MazeApp.roomPairs().length };
  });
  await browser.close();
  console.log(JSON.stringify({ errors, count, imgShown, summary, tableHead, caps, promptHead: prompt.slice(0, 120), promptHasLegend: /Legend:/.test(prompt), check }, null, 1));
  if (errors.length || !imgShown) process.exit(1);
})();
