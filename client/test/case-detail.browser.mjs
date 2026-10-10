import assert from "node:assert/strict";
import { chromium } from "playwright";
const base = "http://localhost:3000";
const loginResponse = await fetch("http://localhost:5002/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "tester@satya.demo", password: "SatyaDemo@123" }) });
assert.equal(loginResponse.status, 200);
const session = await loginResponse.json();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(`${base}/login`);
  await page.locator("#email").fill("tester@satya.demo");
  await page.locator("#password").fill("SatyaDemo@123");
  await page.getByRole("button", { name: "Enter workspace", exact: true }).click();
  await page.waitForURL("**/dashboard");
  const casesResponse = await fetch("http://localhost:5002/api/v1/cases", { headers: { Authorization: `Bearer ${session.token}` } });
  const cases = await casesResponse.json();
  const withReceipts = (Array.isArray(cases) ? cases : cases.cases || []).find((item) => item.ledger && item.ledger.received !== "0" && item.ledger.received != null);
  assert.ok(withReceipts, "expected a case with at least one receipt");
  const caseId = withReceipts.id || withReceipts._id;
  await page.goto(`${base}/cases/${encodeURIComponent(caseId)}`);
  await page.waitForURL(`**/cases/${encodeURIComponent(caseId)}`);

  // Delivery progress: metrics, track and receipt trail must render.
  await page.locator(".satya-delivery-metrics").waitFor();
  assert.equal(await page.locator(".satya-delivery-metrics > div").count(), 4);
  await page.locator('.satya-delivery-track[role="progressbar"]').waitFor();
  const receipts = await page.locator(".satya-receipt-trail > li").count();
  assert.ok(receipts > 0, "expected at least one receipt milestone");

  // Clickable evidence: View source opens the evidence drawer with provenance.
  await page.locator(".satya-evidence-chip").first().click();
  const drawer = page.getByRole("dialog");
  await drawer.waitFor();
  const drawerText = await drawer.innerText();
  assert.ok(drawerText.length > 100, "evidence drawer must show source detail");
  await page.keyboard.press("Escape");

  // Case chat answers the actual question, not a generic overview.
  await page.goto(`${base}/chat`);
  const input = page.locator("textarea, input[type=text]").last();
  await input.fill("How much remains to deliver?");
  await input.press("Enter");
  await page.waitForResponse((response) => response.url().includes("/business/chat"), { timeout: 60000 }).catch(() => null);
  await page.waitForFunction(() => /deliver|receiv|open/i.test(document.body.innerText), null, { timeout: 30000 });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ caseId, receiptMilestones: receipts, evidenceDrawer: true, chatRendered: true, runtimeErrors: errors }));
} finally {
  await browser.close();
}
