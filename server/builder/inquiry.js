/* Trusted progressive enhancement. Static site content remains readable without JavaScript. */
(() => {
  "use strict";
  const storage = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* storage is optional */
      }
    },
    remove(k) {
      try {
        localStorage.removeItem(k);
      } catch {
        /* storage is optional */
      }
    },
  };
  const started = new Date().toISOString(),
    panel = document.querySelector("[data-cookie-panel]");
  const namespace = panel?.dataset.cookieSite ?? "default",
    choiceKey = "gs-privacy-choice:" + namespace,
    visitKey = "gs-first-visit:" + namespace;
  let choice;
  try {
    choice = JSON.parse(storage.get(choiceKey) || "null");
  } catch {
    choice = null;
  }
  if (panel && !["necessary", "optional"].includes(choice?.value))
    panel.hidden = false;
  const buttons = document.querySelectorAll("[data-cookie-choice]");
  buttons.forEach((b) =>
    b.addEventListener("click", () => {
      const value = b.dataset.cookieChoice;
      storage.set(
        choiceKey,
        JSON.stringify({
          value,
          version: "s6-v1",
          at: new Date().toISOString(),
        }),
      );
      if (value === "optional" && !storage.get(visitKey))
        storage.set(visitKey, started);
      if (value !== "optional") storage.remove(visitKey);
      if (panel) panel.hidden = true;
    }),
  );
  document.querySelectorAll("[data-cookie-settings]").forEach((b) =>
    b.addEventListener("click", () => {
      if (panel) {
        panel.hidden = false;
        panel.querySelector("button")?.focus();
      }
    }),
  );
  const form = document.querySelector("[data-gs-inquiry]");
  // A visitor-initiated shortlist is necessary session data, isolated by site.
  const allowed = new Map(
    [...document.querySelectorAll('input[name="productIds"]')].map((n) => [
      n.value,
      n.closest("label").textContent.trim(),
    ]),
  );
  const quoteKey = "gs-inquiry-list:" + namespace;
  let quote = [];
  try {
    const value = JSON.parse(sessionStorage.getItem(quoteKey) || "[]");
    if (Array.isArray(value))
      quote = value.filter((id) => allowed.has(id)).slice(0, 50);
  } catch {
    /* optional session storage */
  }
  function drawQuote() {
    quote = [...new Set(quote)].filter((id) => allowed.has(id));
    try {
      sessionStorage.setItem(quoteKey, JSON.stringify(quote));
    } catch {
      /* usable in memory */
    }
    const bar = document.querySelector(".quote-bar");
    if (bar)
      bar.hidden = !quote.length && !bar.querySelector("[data-quote-add]");
    document
      .querySelectorAll("[data-quote-count]")
      .forEach((n) => (n.textContent = String(quote.length)));
    document.querySelectorAll("[data-quote-add]").forEach((n) => {
      n.textContent = quote.includes(n.dataset.quoteAdd)
        ? "Added to inquiry"
        : "Add to inquiry";
      n.setAttribute(
        "aria-pressed",
        String(quote.includes(n.dataset.quoteAdd)),
      );
    });
    document.querySelectorAll('input[name="productIds"]').forEach((n) => {
      if (quote.includes(n.value)) n.checked = true;
    });
    const list = document.querySelector("[data-quote-list]");
    if (list) {
      list.replaceChildren();
      if (quote.length) {
        const title = document.createElement("h3");
        title.textContent = "Your selected products";
        list.append(title);
      }
      quote.forEach((id) => {
        const line = document.createElement("div"),
          label = document.createElement("span"),
          remove = document.createElement("button");
        label.textContent = allowed.get(id);
        remove.type = "button";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", "Remove " + allowed.get(id));
        remove.onclick = () => {
          quote = quote.filter((v) => v !== id);
          const box = [
            ...document.querySelectorAll('input[name="productIds"]'),
          ].find((n) => n.value === id);
          if (box) box.checked = false;
          drawQuote();
        };
        line.append(label, remove);
        list.append(line);
      });
    }
  }
  document.querySelectorAll("[data-quote-add]").forEach((n) =>
    n.addEventListener("click", () => {
      if (!allowed.has(n.dataset.quoteAdd)) return;
      quote = quote.includes(n.dataset.quoteAdd)
        ? quote.filter((v) => v !== n.dataset.quoteAdd)
        : [...quote, n.dataset.quoteAdd];
      drawQuote();
      document
        .querySelectorAll("[data-quote-status]")
        .forEach((s) => (s.textContent = quote.length + " products selected"));
    }),
  );
  document.querySelectorAll("[data-quote-clear]").forEach((n) =>
    n.addEventListener("click", () => {
      quote = [];
      document
        .querySelectorAll('input[name="productIds"]')
        .forEach((n) => (n.checked = false));
      drawQuote();
    }),
  );
  document.querySelectorAll("[data-quote-review]").forEach((n) =>
    n.addEventListener("click", () => {
      const details = document.querySelector(".inquiry-preview");
      if (details) details.open = true;
      document.querySelector("#inquiry")?.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
      form?.querySelector('input[name="name"]')?.focus({ preventScroll: true });
    }),
  );
  drawQuote();
  const search = document.querySelector("[data-product-search]"),
    category = document.querySelector("[data-category-filter]");
  document
    .querySelectorAll("[data-catalog-tools]")
    .forEach((n) => (n.hidden = false));
  function filterProducts() {
    const value = (search?.value || "").toLowerCase(),
      cat = category?.value || "";
    let visible = 0;
    document.querySelectorAll("[data-product-card]").forEach((n) => {
      const show =
        (!value || n.dataset.productName.toLowerCase().includes(value)) &&
        (!cat || n.dataset.category === cat);
      n.hidden = !show;
      if (show) visible++;
    });
    document
      .querySelectorAll("[data-filter-status]")
      .forEach((n) => (n.textContent = visible + " products"));
    document
      .querySelectorAll("[data-no-products]")
      .forEach((n) => (n.hidden = visible > 0));
  }
  search?.addEventListener("input", filterProducts);
  category?.addEventListener("change", filterProducts);
  if (!form || !form.dataset.endpoint) return;
  const fieldset = form.querySelector("[data-inquiry-fields]"),
    notice = form.querySelector("[data-unavailable]"),
    status = form.querySelector("[data-form-status]"),
    errorBox = form.querySelector("[data-form-error]"),
    endpoint = form.dataset.endpoint,
    preview = form.dataset.previewToken ?? "";
  let widget = null,
    turnstileReady,
    configuration = null,
    lastPayload = "",
    submissionId = crypto.randomUUID();
  function error(message, field) {
    errorBox.hidden = false;
    errorBox.textContent = message;
    errorBox.focus();
    if (field) {
      const node = form.elements.namedItem(field);
      if (node && node.setAttribute) node.setAttribute("aria-invalid", "true");
    }
  }
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (turnstileReady) return turnstileReady;
    turnstileReady = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = () =>
        window.turnstile ? resolve(window.turnstile) : reject(Error());
      script.onerror = () => reject(Error());
      document.head.append(script);
    });
    return turnstileReady;
  }
  const headers = preview ? { "X-Preview-Token": preview } : {};
  async function configure() {
    const res = await fetch(endpoint + "/config", {
      headers,
      credentials: "omit",
      mode: "cors",
      cache: "no-store",
    });
    if (!res.ok) throw Error();
    const body = await res.json();
    configuration = body.data;
    if (!configuration.enabled) {
      notice.hidden = false;
      return;
    }
    if (configuration.privacyVersion !== form.dataset.policyVersion) {
      error(
        "This page's privacy policy has changed. Refresh the page before submitting.",
      );
      return;
    }
    if (configuration.turnstileSiteKey) {
      const t = await loadTurnstile();
      widget = t.render(form.querySelector("[data-turnstile]"), {
        sitekey: configuration.turnstileSiteKey,
        action: "inquiry",
        cData: endpoint.split("/").pop(),
        theme: "auto",
      });
    }
    fieldset.disabled = false;
    notice.hidden = true;
  }
  configure().catch(() =>
    error(
      "The inquiry service is temporarily unavailable. Your form has not been sent. Please try again or contact the company.",
    ),
  );
  form.addEventListener("input", (e) => {
    e.target.removeAttribute?.("aria-invalid");
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    if (!form.reportValidity()) return;
    const get = (name) => String(new FormData(form).get(name) ?? "").trim(),
      files = [...form.elements.attachments.files];
    if (files.length > 3 || files.some((f) => f.size > 2097152)) {
      error(
        "Attach up to three files, each no larger than 2 MB.",
        "attachments",
      );
      return;
    }
    if (
      files.some(
        (f) =>
          ![
            "image/jpeg",
            "image/png",
            "image/webp",
            "application/pdf",
          ].includes(f.type),
      )
    ) {
      error("Use JPEG, PNG, WebP or PDF attachments.", "attachments");
      return;
    }
    const utm = {};
    for (const key of ["source", "medium", "campaign", "term", "content"])
      utm[key] =
        new URL(location.href).searchParams.get("utm_" + key)?.slice(0, 200) ??
        null;
    const payload = {
      submissionId,
      name: get("name"),
      company: get("company"),
      email: get("email"),
      country: get("country"),
      phone: get("phone"),
      productIds: [
        ...form.querySelectorAll('input[name="productIds"]:checked'),
      ].map((n) => n.value),
      quantity: get("quantity") ? Number(get("quantity")) : null,
      message: get("message"),
      website: get("website"),
      privacyConsent: form.elements.privacyConsent.checked,
      privacyVersion: form.dataset.policyVersion,
      pageUrl: location.origin + location.pathname,
      referrer: document.referrer || null,
      utm,
      firstVisitAt: Number.isFinite(Date.parse(storage.get(visitKey) ?? ""))
        ? storage.get(visitKey)
        : started,
      turnstileToken:
        widget !== null ? window.turnstile.getResponse(widget) : "",
    };
    const stable = JSON.stringify({
      ...payload,
      submissionId: undefined,
      turnstileToken: undefined,
      files: files.map((f) => ({
        name: f.name,
        size: f.size,
        lastModified: f.lastModified,
      })),
    });
    if (lastPayload && lastPayload !== stable)
      submissionId = crypto.randomUUID();
    payload.submissionId = submissionId;
    lastPayload = stable;
    if (configuration?.turnstileSiteKey && !payload.turnstileToken) {
      error("Complete the security check before sending your inquiry.");
      return;
    }
    const body = new FormData();
    body.set("payload", JSON.stringify(payload));
    files.forEach((f) => body.append("attachments", f));
    fieldset.disabled = true;
    status.textContent = "Saving your inquiry…";
    try {
      const res = await fetch(endpoint + "/inquiries", {
        method: "POST",
        body,
        headers,
        credentials: "omit",
        mode: "cors",
      });
      const response = await res.json();
      if (!res.ok) {
        const code = response.error?.code;
        const messages = {
          INQUIRY_RATE_LIMIT:
            "Too many submissions. Please wait a minute and try again.",
          TURNSTILE_REQUIRED: "Complete the security check.",
          TURNSTILE_INVALID:
            "The security check expired. Please complete it again.",
          TURNSTILE_UNAVAILABLE:
            "The security check is temporarily unavailable. Your inquiry was not saved. Please retry.",
          INQUIRIES_NOT_ENABLED:
            "Online inquiries are currently unavailable. Please contact the company.",
          PRIVACY_VERSION_CHANGED:
            "The privacy policy changed. Refresh this page before submitting.",
          INQUIRY_ATTACHMENT_LIMIT:
            "Attach up to three files, each no larger than 2 MB.",
          INQUIRY_ATTACHMENT_TYPE: "Use JPEG, PNG, WebP or PDF attachments.",
          QUOTA_EXCEEDED:
            "The attachment could not be stored. Remove attachments and retry; you can still send your message.",
          IDEMPOTENCY_CONFLICT:
            "This submission changed. Please retry to send the updated inquiry.",
        };
        throw Error(
          messages[code] ||
            "Your inquiry could not be saved. Please retry or contact the company.",
        );
      }
      status.textContent =
        "Your inquiry has been saved. Our team will review it. Reference: " +
        response.data.receiptId;
      form.reset();
      submissionId = crypto.randomUUID();
      lastPayload = "";
    } catch (e) {
      status.textContent = "";
      error(
        e.message ||
          "The request failed. Your entries are still available; please retry.",
      );
    } finally {
      fieldset.disabled = false;
      if (widget !== null) window.turnstile.reset(widget);
    }
  });
})();

// Native disclosures work without scripts. Dismiss them when a shopper leaves the menu.
function closeStoreMenus(event) {
  const menus = Array.from(
    document.querySelectorAll(".site-header details[open]"),
  ).reverse();
  for (const menu of menus) {
    if (event.type === "keydown") {
      if (event.key === "Escape" && menu.contains(document.activeElement)) {
        menu.open = false;
        menu.querySelector("summary").focus();
        return;
      }
    } else if (!menu.contains(event.target) || event.target.closest("a")) {
      menu.open = false;
    }
  }
}
document.addEventListener("click", closeStoreMenus);
document.addEventListener("keydown", closeStoreMenus);
