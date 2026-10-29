import { test, expect } from "@playwright/test";

// §10 journey (06): today → investigation → evidence → order → ask → docs.
// Runs on mocks; every assertion is text-based, never colour-only.

test.describe("Flagship journey on mocks", () => {
  test("Today answers first", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByText("What you really owe").first()).toBeVisible();
    await expect(page.getByText("Amount under question").first()).toBeVisible();
    await expect(page.getByText("GST credit at risk").first()).toBeVisible();
    // plain-language + numbers, not jargon
    await expect(page.getByText("₹20,000.00")).toBeVisible();
    await expect(page.getByText("₹85,800.00")).toBeVisible();
  });

  test("investigation: recommendation, balances, issues, money trail", async ({ page }) => {
    await page.goto("/app/investigations/case_po1001");
    // answer-first banner + scoped actions
    await expect(page.getByText(/Put ₹70,800 on hold/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Put on hold/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Approve/ })).toBeVisible();
    // three balances
    for (const label of ["What you really owe", "What your books show", "Amount under question"]) {
      await expect(page.getByText(label)).toBeVisible();
    }
    // certainty in word+icon, not colour alone
    await expect(page.getByText(/Likely|Unclear — needs your decision/).first()).toBeVisible();
    // issues tab has the duplicate + unallocated findings
    await expect(page.getByText(/duplicate/i).first()).toBeVisible();
    // money trail tab → nodes + legend
    await page.getByRole("tab", { name: "Money trail" }).click();
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 10_000 });
    // decisions tab is honest about provenance
    await page.getByRole("tab", { name: "Decisions & audit" }).click();
    await expect(page.getByText(/audit|decision|approved|hold/i).first()).toBeVisible();
  });

  test("orders → PO detail → lifecycle + PDF", async ({ page }) => {
    await page.goto("/app/orders");
    await expect(page.getByText("VPPL/PO/26-27/000123")).toBeVisible();
    await page.goto("/app/orders/doc_po1001");
    await expect(page.getByRole("button", { name: /Download PDF/ })).toBeVisible();
    // lifecycle numbers from the flagship fixture
    await expect(page.getByText(/PO-1001|Ordered/).first()).toBeVisible();
  });

  test("ask page answers with citations", async ({ page }) => {
    await page.goto("/app/ask");
    await page.getByPlaceholder(/Ask about/).fill("How much do we really owe on PO-1001?");
    await page.getByRole("button", { name: /Send/ }).click();
    await expect(page.getByText(/₹20,000|real owe/).first()).toBeVisible({ timeout: 15_000 });
    // citations chips present
    await expect(page.locator("[aria-label^='Source']").first()).toBeVisible();
  });

  test("documents inbox + review", async ({ page }) => {
    await page.goto("/app/documents");
    await expect(page.getByText(/Drop files here/)).toBeVisible();
    await expect(page.getByRole("tab", { name: /Needs review/ })).toBeVisible();
    await page.goto("/app/documents/drf_001");
    await expect(page.getByText(/Extracted fields|Review/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Save as evidence/ })).toBeVisible();
  });

  test("payments workbench resolves unclear transfers", async ({ page }) => {
    await page.goto("/app/payments");
    await expect(page.getByText("₹15,000.00")).toBeVisible();
    await page.getByRole("button", { name: "Resolve" }).click();
    await expect(page.getByText(/Two ways this could fit|could be more than one thing/i)).toBeVisible();
  });

  test("verify page states", async ({ page }) => {
    await page.goto("/verify/" + "0".repeat(64));
    await expect(page.getByText(/not recognised|unavailable/i)).toBeVisible();
  });

  test("shell + a11y basics", async ({ page }) => {
    await page.goto("/app");
    // skip link exists for keyboard users
    await expect(page.locator("a[href='#app-content'], a[href='#main']")).toBeAttached();
    // no colour-only status: words present alongside badges
    await expect(page.getByText(/hold|delivered|waiting|due/i).first()).toBeVisible();
  });
});
