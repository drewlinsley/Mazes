// Opens web/index.html in headless Chromium, exercises the three tabs and saves screenshots.
// usage: NODE_PATH=$(npm root -g) node tests/screenshot.js OUT_DIR
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
  await page.screenshot({ path: path.join(out, '1-task-setup.png') });

  // run a short block: 4 trials, answer with keys
  await page.fill('#task-n', '4');
  await page.fill('#task-seed', '2024');
  await page.fill('#task-fix', '50');
  await page.click('#task-start');
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(out, '2-task-trial.png') });
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(120);
    await page.keyboard.press(i % 2 ? 'j' : 'f');
    await page.waitForTimeout(1800);
  }
  await page.waitForSelector('#task-results:not([hidden])', { timeout: 10000 });
  await page.screenshot({ path: path.join(out, '3-task-results.png') });
  const summary = await page.textContent('#task-summary');

  // explore tab, pair view with the components overlay
  await page.click('.tab[data-tab="explore"]');
  await page.selectOption('#explore-overlay', 'components');
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(out, '4-explore-pair.png'), fullPage: true });
  const meta = await page.textContent('#explore-meta');

  // model tab (no request is made)
  await page.click('.tab[data-tab="model"]');
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(out, '5-model.png') });

  // consistency checks against the generator: trial seeds and labels
  const check = await page.evaluate(() => {
    const trials = MazeApp.buildTrials(6, '2024');
    const labels = trials.map(t => t.solvable);
    const answered = [{ solvable: true, answer: 'yes', correct: true, rt: 900 }, { solvable: false, answer: 'yes', correct: false, rt: 700 }, { solvable: false, answer: 'no', correct: true, rt: 500 }];
    return { seeds: trials.map(t => t.seed), labels: labels, nPos: labels.filter(Boolean).length, probit: MazeApp.probit(0.975), summary: MazeApp.summarize(answered), parse: [MazeApp.parseAnswer('blah\nANSWER: NO'), MazeApp.parseAnswer('yes it is.\nANSWER: YES'), MazeApp.parseAnswer('I think no'), MazeApp.parseAnswer('unclear')] };
  });
  await browser.close();
  console.log(JSON.stringify({ errors, summary: summary.replace(/\s+/g, ' ').trim(), metaHead: meta.slice(0, 160), check }, null, 1));
  if (errors.length) process.exit(1);
})();
