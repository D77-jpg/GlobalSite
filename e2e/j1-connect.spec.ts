import { test, expect } from "@playwright/test";
import { login } from "./helpers/site-login";
import { randomUUID } from "node:crypto";
test("J1 two applications: CRM UI credential, sync, preview inquiry, attachment and safe reply draft", async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(300000);
  const buyerEmail = "buyer@j1-" + randomUUID() + ".example.invalid";
  page.setDefaultTimeout(20000);
  console.log("J1: starting CRM sign-in");
  test.skip(
    !process.env.J1_CRM_URL,
    "Start both isolated J1 fixtures to run this test",
  );
  const crmBase = process.env.J1_CRM_URL!;
  const crmContext = await browser.newContext({ baseURL: crmBase });
  crmContext.setDefaultTimeout(20000);
  const crmPage = await crmContext.newPage();
  try {
    const crmLogin = await crmPage.request.post("/api/auth/login", {
      headers: { Origin: crmBase },
      data: {
        username: "fictional-j1-manager",
        password: "Fictional-J1-Login-Only",
      },
    });
    expect(crmLogin.ok(), "CRM session login").toBeTruthy();
    await crmPage.goto("/projects/integrations");
    await crmPage
      .getByRole("heading", { name: "集成与连接", exact: true })
      .waitFor();
    console.log("J1: credential settings loaded");
    const projectResponse = await crmPage.request.get("/api/projects");
    expect(projectResponse.ok()).toBeTruthy();
    const projects = (await projectResponse.json()).data;
    const projectId = String(
      (Array.isArray(projects) ? projects : projects.items).find(
        (p: any) => p.name === "FICTIONAL J1",
      ).id,
    );
    await crmPage
      .getByRole("button", { name: "新建凭证", exact: true })
      .click();
    const dialog = crmPage.getByRole("dialog");
    await dialog
      .getByLabel("凭证名称", { exact: true })
      .fill("FICTIONAL J1 GlobalSite");
    await dialog.getByRole("button", { name: "新建凭证", exact: true }).click();
    await crmPage.getByRole("heading", { name: "保存你的连接凭证" }).waitFor();
    // Keep the one-time credential in memory only; no screenshot, traces or logging.
    const credential = (await crmPage.locator("[data-secret]").textContent())!;
    expect(/^gci_[a-f0-9]{48}$/.test(credential)).toBeTruthy();
    await crmPage.getByRole("button", { name: "我已保存，关闭" }).click();
    await crmPage.locator("[data-secret]").waitFor({ state: "detached" });

    console.log("J1: one-time credential dialog closed");
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await login(page, request);
    console.log("J1: GlobalSite registered and signed in");
    const origin = process.env.E2E_BASE_URL ?? "http://localhost:5080",
      csrf = (await page.context().cookies()).find(
        (c) => c.name === "gs_csrf",
      )!.value;
    async function call(method: string, path: string, data?: unknown) {
      const r = await page.request.fetch("/api/v1" + path, {
        method,
        headers: {
          Origin: origin,
          "X-CSRF-Token": csrf,
          "Idempotency-Key": randomUUID(),
        },
        data,
      });
      expect(r.ok(), path + " " + r.status()).toBeTruthy();
      return (await r.json()).data;
    }

    await page.goto("/crm");
    await page.getByLabel("CRM 地址", { exact: true }).fill(crmBase);
    await page.getByLabel("CRM 项目 ID", { exact: true }).fill(projectId);
    await page.getByLabel("服务凭证", { exact: true }).fill(credential);
    await page.getByRole("button", { name: "连接并测试", exact: true }).click();
    await expect(page.locator(".catalog-badge").first()).toHaveText("已连接", {
      timeout: 20000,
    });
    expect(
      (await page.getByLabel("服务凭证", { exact: true }).inputValue()).length,
    ).toBe(0);
    expect(
      await page.evaluate(
        (v) => !JSON.stringify([localStorage, sessionStorage]).includes(v),
        credential,
      ),
    ).toBeTruthy();
    await page.getByRole("button", { name: "立即同步", exact: true }).click();
    await expect
      .poll(async () => (await call("GET", "/products")).items.length, {
        timeout: 30000,
      })
      .toBe(1);
    const products = (await call("GET", "/products")).items;
    console.log("J1: public product synchronized");
    expect(products[0].source).toBe("globalcrm");
    expect(products[0].externalRef.remoteId).toBeTruthy();
    const factRows = (await call("GET", "/facts")).items;
    expect(factRows.length).toBeGreaterThan(0);
    expect(factRows.every((f: any) => f.status === "candidate")).toBeTruthy();
    for (const f of factRows)
      await call("POST", "/facts/" + f.id + "/confirm", {
        revision: f.revision,
      });
    await page.screenshot({
      path: "test-results/j1-connection-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(async () => {
        const box = await page.locator(".sidebar").boundingBox();
        return box!.x + box!.width;
      })
      .toBeLessThanOrEqual(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: "test-results/j1-connection-mobile.png",
      fullPage: false,
    });
    await page.getByRole("button", { name: "切换语言", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Connect GlobalCRM", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Change language", exact: true })
      .click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    console.log("J1: creating site preview");
    let site = await call("POST", "/sites", {
      name: "Fictional Export Website",
      templateId: "machinery",
      targetMarkets: ["UK"],
      language: "en",
      brandColor: "#16634a",
      logoId: null,
      productIds: products.map((p) => p.id),
    });
    const nodes = [
      {
        key: "home",
        path: "/",
        title: "Industrial sourcing",
        type: "home",
        parentKey: null,
        productId: null,
        keywords: [],
        intent: "source",
      },
      ...products.map((p, i) => ({
        key: "product-" + i,
        path: "/products/sample-" + i,
        title: p.name,
        type: "product",
        parentKey: "home",
        productId: p.id,
        keywords: [],
        intent: "source",
      })),
    ];
    site = await call("PUT", "/sites/" + site.id + "/plan", {
      revision: site.planRevision,
      nodes,
      keywords: [],
      clusters: [],
    });
    site = await call("POST", "/sites/" + site.id + "/plan/confirm", {
      revision: site.planRevision,
    });
    const text =
      "Our team helps buyers explore product options and prepare a clear purchasing brief. Share your application, preferred materials, packaging requirements and intended market with our team. We will discuss the details with you before preparing a proposal. Browse the information below to learn about our approach and find the right contact for your project. Product details are reviewed by our team before publication.";
    for (const node of nodes) {
      let p = await call("POST", "/sites/" + site.id + "/pages", {
        nodeKey: node.key,
      });
      const blocks = p.blocks.filter((b: any) => b.key !== "overview");
      blocks.push({
        key: "overview",
        type: "text",
        heading: "Purchasing support",
        body: text,
        refs: [],
        table: null,
        faq: [],
        assetId: null,
        alt: "",
      });
      p = await call("PATCH", "/pages/" + p.id, {
        revision: p.revision,
        data: {
          title: p.title,
          metaDescription: p.metaDescription,
          refs: p.refs,
          blocks,
        },
      });
      if (p.issues.length)
        console.log(
          "J1 page checks",
          p.issues.map((i: any) => ({
            code: i.code,
            field: i.field,
            token: i.token,
          })),
        );
      await call("POST", "/pages/" + p.id + "/approve", {
        revision: p.revision,
      });
    }
    await page.goto("/sites/" + site.id + "/inquiry-settings");
    await page
      .getByRole("checkbox", { name: "启用在线询盘", exact: true })
      .check();
    await page.getByRole("checkbox", { name: /我已审阅隐私政策模板/ }).check();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByText("已保存", { exact: true })).toBeVisible();
    await call("PUT", "/sites/" + site.id + "/publishing-settings", {
      revision: 0,
      canonicalBaseUrl: "https://j1.example.invalid",
      accountId: null,
      projectName: null,
      productionBranch: "main",
      domain: null,
    });
    const version = await call("POST", "/sites/" + site.id + "/builds", {});
    let ready = false;
    for (let i = 0; i < 55; i++) {
      const v = await call("GET", "/site-versions/" + version.id);
      if (v.status === "failed")
        throw Error("Static build failed: " + v.errorCode);
      if (v.status === "ready") {
        ready = true;
        break;
      }
      await page.waitForTimeout(2000);
    }
    expect(ready).toBeTruthy();
    const preview = await page.context().newPage();
    preview.on("pageerror", (e) => errors.push(e.message));
    await preview.goto(
      "/api/v1/site-versions/" + version.id + "/preview/?utm_source=fixture-j1",
    );
    await expect(
      preview.getByRole("heading", {
        name: "Your privacy choices",
        exact: true,
      }),
    ).toBeVisible();
    await preview
      .getByRole("button", { name: "Reject optional", exact: true })
      .click();
    await expect(
      preview.getByRole("heading", {
        name: "Your privacy choices",
        exact: true,
      }),
    ).toBeHidden();
    expect(
      await preview.evaluate(() =>
        Object.keys(localStorage).some((k) => k.startsWith("gs-first-visit:")),
      ),
    ).toBeFalsy();
    await expect(preview.getByLabel("Your name", { exact: false })).toBeEnabled(
      {
        timeout: 15000,
      },
    );
    await preview
      .getByLabel("Your name", { exact: false })
      .fill("Fixture Buyer");
    await preview.getByLabel("Work email", { exact: false }).fill(buyerEmail);
    await preview
      .getByLabel("Company", { exact: true })
      .fill("Synthetic Buyer Company");
    await preview.getByLabel("Country", { exact: true }).fill("Germany");
    await preview
      .getByLabel("Phone / WhatsApp", { exact: true })
      .fill("+000000000");
    await preview
      .getByRole("checkbox", { name: "Fixture Pump", exact: true })
      .check();

    await preview.getByLabel("Quantity", { exact: true }).fill("12");
    await preview
      .getByLabel("Your requirements", { exact: false })
      .fill("Please discuss the product options for our purchasing project.");
    await preview.getByLabel("Attachments", { exact: true }).setInputFiles({
      name: "synthetic.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nSynthetic fixture only\n%%EOF"),
    });
    await preview
      .getByRole("checkbox", { name: /I have read the Privacy Policy/ })
      .check();
    await preview
      .getByRole("button", { name: "Send inquiry", exact: true })
      .click();
    await expect(preview.locator("[data-form-status]")).toContainText(
      "Your inquiry has been saved",
      { timeout: 20000 },
    );
    await preview
      .getByRole("link", { name: "Privacy Policy", exact: true })
      .first()
      .click();
    await expect(
      preview.getByRole("heading", { name: "Privacy Policy", exact: true }),
    ).toBeVisible();
    expect(
      await preview.locator('meta[name="robots"]').getAttribute("content"),
    ).toContain("noindex");
    await preview.close();
    await page.goto("/inquiries?siteId=" + site.id);
    await page
      .getByRole("link", { name: "Fixture Buyer", exact: true })
      .click();
    await expect(
      page.getByText(
        "Please discuss the product options for our purchasing project.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Fixture Pump", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "synthetic.pdf", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("fixture-j1", { exact: true })).toBeVisible();
    await expect
      .poll(
        async () => {
          const id = new URL(page.url()).pathname.split("/").pop();
          const r = await page.request.get("/api/v1/inquiries/" + id);
          return (await r.json()).data.classification;
        },
        { timeout: 20000 },
      )
      .not.toBe("pending");
    await page.reload();
    await page.getByLabel("状态", { exact: true }).selectOption("following");
    await expect(page.getByLabel("状态", { exact: true })).toHaveValue(
      "following",
    );
    await page
      .getByLabel("添加备注", { exact: true })
      .fill("Synthetic follow-up note");
    await page.getByRole("button", { name: "保存备注", exact: true }).click();
    await expect(
      page.getByText("Synthetic follow-up note", { exact: true }),
    ).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: "test-results/j1-inquiry-desktop.png",
      fullPage: false,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(
        async () =>
          (await page.locator(".sidebar").boundingBox())!.x +
          (await page.locator(".sidebar").boundingBox())!.width,
      )
      .toBeLessThanOrEqual(0);
    await expect(page.getByLabel("状态", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: "test-results/j1-inquiry-mobile.png",
      fullPage: false,
    });
    const csv = await page.request.get(
      "/api/v1/inquiries/export?siteId=" + site.id,
    );
    expect(csv.status()).toBe(200);
    expect(await csv.text()).toContain(buyerEmail);

    const inquiryId = new URL(page.url()).pathname.split("/").pop()!;
    await expect
      .poll(
        async () => (await call("GET", "/inquiries/" + inquiryId)).crm?.status,
        { timeout: 45000 },
      )
      .toBe("sent");
    const linked = (await call("GET", "/inquiries/" + inquiryId)).crm;
    expect(linked.customerId).toBeTruthy();
    await page.reload();
    await expect(
      page.getByRole("link", { name: "在 CRM 查看客户", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/j1-inquiry-desktop.png",
      fullPage: false,
    });
    await crmPage.goto("/customers/" + linked.customerId);
    await crmPage
      .getByRole("heading", { name: "GlobalSite 询盘记录", exact: true })
      .waitFor();
    await crmPage
      .getByText(
        "Please discuss the product options for our purchasing project.",
        { exact: true },
      )
      .waitFor();
    await crmPage.locator("#globalsite-inquiries summary").first().click();
    await crmPage.getByText("fixture-j1", { exact: false }).first().waitFor();
    const list = async () => {
      const r = await crmPage.request.get(
        "/api/globalsite-inquiries?customerId=" + linked.customerId,
        { headers: { "X-Project-Id": projectId } },
      );
      expect(r.ok()).toBeTruthy();
      return (await r.json()).data.items;
    };
    await expect
      .poll(
        async () => {
          const rows = await list();
          return rows[0]?.attachments[0]?.status;
        },
        { timeout: 30000 },
      )
      .toBe("stored");
    const rows = await list();
    expect(rows.length).toBe(1);
    const file = await crmPage.request.get(
      "/api/globalsite-inquiries/" +
        rows[0].id +
        "/attachments/" +
        rows[0].attachments[0].id,
      { headers: { "X-Project-Id": projectId } },
    );
    expect(file.ok()).toBeTruthy();
    expect((await file.body()).toString()).toContain("Synthetic fixture only");
    await crmPage
      .getByRole("button", { name: "生成回复初稿", exact: true })
      .click();
    await crmPage
      .getByText("回复初稿已保存，发送前请审核。", { exact: false })
      .waitFor();
    await crmPage.locator("#globalsite-inquiries").scrollIntoViewIfNeeded();
    await crmPage.screenshot({
      path: "test-results/j1-crm-inquiry.png",
      fullPage: false,
    });
    expect(errors).toEqual([]);
  } finally {
    await crmContext.close();
  }
});
