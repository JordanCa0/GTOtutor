import { expect, test, type Page } from '@playwright/test';

/** Phones upright and on their side, the smallest supported phone, and a desktop (which must not change). */
const SIZES = [
  { name: 'small phone', width: 320, height: 568, touch: true },
  { name: 'iPhone SE (Safari)', width: 375, height: 548, touch: true },
  { name: 'iPhone 15 (Safari)', width: 390, height: 664, touch: true },
  { name: 'Android', width: 412, height: 780, touch: true },
  { name: 'phone landscape', width: 844, height: 390, touch: true },
  { name: 'tablet portrait', width: 768, height: 1024, touch: true },
  { name: 'desktop', width: 1280, height: 800, touch: false },
];

/** Skip the title screen and the first-run tour; this test is about layout. */
async function freshVisit(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('gtotutor.seenTitle', '1');
    localStorage.setItem('gtotutor.seenTour.play', '1');
    localStorage.setItem('gtotutor.seenTour.verdict', '1');
  });
  await page.goto('/');
  await page.waitForSelector('.setup');
}

const overflow = (page: Page) =>
  page.evaluate(() => ({
    x: document.documentElement.scrollWidth - innerWidth,
    y: document.documentElement.scrollHeight - innerHeight,
  }));

/** Waits until the hand is waiting on hero (or over), skipping the deal animation. */
async function waitForTurn(page: Page) {
  await page.locator('.table-wrap').click({ position: { x: 4, y: 4 } });
  await page.waitForSelector('.actions .act:not(.act-skeleton), .result-strip', { timeout: 20_000 });
}

for (const size of SIZES) {
  test.describe(`${size.name} ${size.width}×${size.height}`, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch, isMobile: size.touch });

    test('no screen scrolls sideways, and play fits one screen', async ({ page }) => {
      await freshVisit(page);
      expect((await overflow(page)).x, 'setup scrolls sideways').toBeLessThanOrEqual(0);

      await page.click('.setup .primary.big');
      await waitForTurn(page);
      let o = await overflow(page);
      expect(o.x, 'table scrolls sideways').toBeLessThanOrEqual(0);
      expect(o.y, 'table needs vertical scrolling').toBeLessThanOrEqual(0);

      // The table keeps its size through a decision.
      const before = await page.locator('.table-wrap').boundingBox();
      const act = page.locator('.actions .act-fold:not(.unavailable), .actions .act-call, .actions .act').first();
      if (await act.count()) {
        await act.click();
        await page.waitForSelector('.verdict', { state: 'attached', timeout: 20_000 });
        await page.locator('.table-wrap').click({ position: { x: 4, y: 4 } });
        await page.waitForTimeout(300);
        const after = await page.locator('.table-wrap').boundingBox();
        expect(after?.width).toBeCloseTo(before!.width, 0);
        expect(after?.height).toBeCloseTo(before!.height, 0);
        o = await overflow(page);
        expect(o.x, 'after a decision: scrolls sideways').toBeLessThanOrEqual(0);
        expect(o.y, 'after a decision: needs vertical scrolling').toBeLessThanOrEqual(0);
      }
    });

    test('touch targets are big enough', async ({ page }) => {
      test.skip(!size.touch, 'touch screens only');
      await freshVisit(page);
      await page.click('.setup .primary.big');
      await waitForTurn(page);
      // Table actions and the strip: 44px tall (Apple's minimum). Everything else: 24×24 (WCAG 2.2).
      for (const box of await page.locator('.actions .act, .feedback-strip, .result-strip .primary').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
        expect(box).toBeGreaterThanOrEqual(44);
      }
      const small = await page.locator('button:visible').evaluateAll((els) =>
        els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && (r.width < 24 || r.height < 24)).length,
      );
      expect(small, 'buttons under 24×24').toBe(0);
    });

    test('the phone sheet opens, switches tabs and closes', async ({ page }) => {
      test.skip(size.width >= 1024, 'phone and tablet layout only');
      await freshVisit(page);
      await page.click('.setup .primary.big');
      await waitForTurn(page);
      const strip = page.locator('.feedback-strip');
      await expect(strip).toBeEnabled();
      await strip.click();
      const sheet = page.locator('.sheet');
      await expect(sheet).toHaveAttribute('data-open', 'true');
      for (const tab of await page.locator('.sheet-tabs button').all()) {
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        expect((await overflow(page)).x).toBeLessThanOrEqual(0);
      }
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveAttribute('data-open', 'false');
      await strip.click();
      await page.locator('.sheet-close').click();
      await expect(sheet).toHaveAttribute('data-open', 'false');
    });

    test('the header menu and pop-ups fit', async ({ page }) => {
      await freshVisit(page);
      await page.click('.setup .primary.big');
      await waitForTurn(page);
      const phoneMenu = size.width < 1024;
      if (phoneMenu) {
        await page.click('.menu-btn');
        expect((await overflow(page)).x).toBeLessThanOrEqual(0);
        await page.getByRole('menuitem', { name: 'Session review' }).click();
      } else {
        await page.click('.review-btn');
      }
      await page.waitForSelector('.modal');
      const modal = await page.locator('.modal').boundingBox();
      expect(modal!.x).toBeGreaterThanOrEqual(0);
      expect(modal!.x + modal!.width).toBeLessThanOrEqual(size.width + 0.5);
      expect((await overflow(page)).x).toBeLessThanOrEqual(0);
    });
  });
}
