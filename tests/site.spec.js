const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.route(/^https:\/\//, route => route.abort());
});

test("loads the Ground RB workspace with current static data", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toHaveClass(/dark-mode/);
  await expect(page.locator("#result-count")).toContainText("vehicles");
  await expect(page.locator("#ground-min-battles")).toHaveValue("400");
  await expect(page.locator("#workspace-drawer")).toBeHidden();
  expect(await page.locator("script[src*='googletagmanager'], img[src*='getloli']").count()).toBe(0);
});

test("uses four cards on a wide desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const cards = page.locator(".vehicle-card");
  await expect(cards.nth(3)).toBeVisible();
  const boxes = await Promise.all([0, 1, 2, 3].map(index => cards.nth(index).boundingBox()));
  expect(new Set(boxes.map(box => Math.round(box.y))).size).toBe(1);
});

test("keeps the mobile toolbar compact and navigation usable", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/");
  const sort = await page.locator("#ground-sort").boundingBox();
  const toggle = await page.locator(".results-controls .view-toggle").boundingBox();
  expect(toggle.y - (sort.y + sort.height)).toBeLessThan(120);
  await expect(page.locator("#mobile-nav-toggle")).toBeVisible();
  await page.locator("#mobile-nav-toggle").click();
  await expect(page.locator("#stacked-area")).toBeVisible();
});

test("opens details, trends, change feed, and lineup in the workspace drawer", async ({ page }) => {
  await page.goto("/");
  await page.locator(".vehicle-card [data-select]").first().click();
  await expect(page.locator("#workspace-drawer")).toBeVisible();
  await expect(page.locator("#workspace-drawer-content .confidence")).toBeVisible();
  await page.locator("#open-current-trend").click();
  await expect(page.locator(".trend-snapshot-grid")).toBeVisible();
  await page.locator("#workspace-drawer-close").click();
  await page.locator("#open-changes").click();
  await expect(page.locator(".change-feed")).toBeVisible();
  await page.locator("#workspace-drawer-close").click();
  await page.locator("#open-lineup").click();
  await expect(page.locator(".lineup-list")).toBeVisible();
});

test("persists filters in the URL and supports favourites-only results", async ({ page }) => {
  await page.goto("/");
  await page.locator(".vehicle-card [data-fav-toggle]").first().click();
  await page.locator("#ground-favorites").selectOption("favorites");
  await expect(page.locator("#result-count")).toContainText("1 vehicle");
  await page.locator("#ground-search").fill("Merkava");
  await expect(page).toHaveURL(/q=Merkava/);
  await expect(page).toHaveURL(/favorites=1/);
});

test("freezes the Vehicle column during horizontal table scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/");
  await page.locator("#view-table").click();
  const wrapper = page.locator("#ground-table-view");
  const firstCell = page.locator("#ground-results tr").first().locator("td").first();
  const before = await firstCell.boundingBox();
  await wrapper.evaluate(element => { element.scrollLeft = 500; });
  const after = await firstCell.boundingBox();
  expect(Math.abs(after.x - before.x)).toBeLessThan(2);
});

test("serves installable PWA and compact data assets", async ({ request }) => {
  expect((await request.get("/manifest.webmanifest")).ok()).toBeTruthy();
  expect((await request.get("/sw.js")).ok()).toBeTruthy();
  const rows = await (await request.get("/data/latest-joined.json")).json();
  const trends = await (await request.get("/data/vehicle-trends.json")).json();
  expect(rows.length).toBeGreaterThan(500);
  expect(Object.keys(trends.vehicles).length).toBeGreaterThan(500);
});
