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
