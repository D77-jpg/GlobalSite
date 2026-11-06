import type { Snapshot } from "./static-template.service";
const e = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function renderInquiry(s: Snapshot, p: any) {
  const c = (s as any).inquiry ?? {},
    products = s.pages.filter((v) => v.type === "product" && v.productId),
    endpoint = c.publicId ? c.gatewayUrl + "/sites/" + c.publicId : "";
  return (
    '<section class="section" id="inquiry"><div class="inquiry"><h2>Tell us what you need</h2><p>Your inquiry is saved before our team is notified. Please do not include sensitive personal information.</p><form data-gs-inquiry data-endpoint="' +
    e(endpoint) +
    '" data-policy-version="' +
    e(c.privacyVersion ?? "") +
    '" enctype="multipart/form-data"><div data-form-status role="status" aria-live="polite"></div><div data-form-error role="alert" tabindex="-1" hidden></div><fieldset data-inquiry-fields disabled><legend>Your inquiry</legend><div class="fields"><label>Your name <span aria-hidden="true">*</span><input type="text" name="name" autocomplete="name" maxlength="100" required></label><label>Company<input type="text" name="company" autocomplete="organization" maxlength="160"></label><label>Work email <span aria-hidden="true">*</span><input type="email" name="email" autocomplete="email" maxlength="200" required></label><label>Country<input type="text" name="country" autocomplete="country-name" maxlength="80"></label><label>Phone / WhatsApp<input type="tel" name="phone" autocomplete="tel" maxlength="80"></label><label>Quantity<input type="number" name="quantity" min="1" max="1000000000" step="1"></label></div>' +
    (products.length
      ? '<fieldset class="product-choices"><legend>Products of interest (select all that apply)</legend>' +
        products
          .map(
            (v) =>
              '<label><input type="checkbox" name="productIds" value="' +
              e(v.productId) +
              '" ' +
              (p.productId === v.productId ? "checked" : "") +
              ">" +
              e(v.title) +
              "</label>",
          )
          .join("") +
        "</fieldset>"
      : "") +
    '<label>Your requirements <span aria-hidden="true">*</span><textarea name="message" maxlength="8000" required></textarea></label><label>Attachments<input type="file" name="attachments" accept="image/jpeg,image/png,image/webp,application/pdf" multiple></label><p class="form-hint">Up to three JPEG, PNG, WebP or PDF files; each no larger than 2 MB.</p><label class="gs-honeypot" aria-hidden="true">Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label><label class="consent-line"><input type="checkbox" name="privacyConsent" required>I have read the <a href="' +
    e(c.privacyPath ?? "/privacy-policy") +
    '">Privacy Policy</a> and agree to the use of my information to respond to this inquiry.</label><div data-turnstile></div><p><button type="submit">Send inquiry</button></p></fieldset><p data-unavailable ' +
    (c.enabled ? "hidden" : "") +
    ">Online inquiries are not enabled. Please use the company contact details on this website.</p><noscript><p>Enable JavaScript to submit securely, or contact the company using its published contact details.</p></noscript></form></div></section>"
  );
}
export function renderConsent(s?: Snapshot) {
  return (
    '<section class="gs-cookie" data-cookie-panel data-cookie-site="' +
    e(s?.inquiry?.publicId ?? s?.site?.id ?? s?.site?.name ?? "default") +
    '" role="dialog" aria-labelledby="gs-cookie-title" hidden><h2 id="gs-cookie-title">Your privacy choices</h2><p>Only necessary functions are active. No optional analytics or advertising is loaded. You can accept or reject optional storage and change your choice at any time.</p><div><button type="button" data-cookie-choice="necessary">Reject optional</button><button type="button" data-cookie-choice="optional">Allow optional</button></div></section>'
  );
}
export function privacyPath(s: Snapshot) {
  return (s as any).inquiry?.privacyPath ?? "/privacy-policy";
}
export function renderPrivacy(s: Snapshot) {
  const c = (s as any).inquiry ?? {},
    facts = c.policyFacts ?? [],
    value = (key: string) => facts.find((f: any) => f.type === key)?.value;
  const name = value("company.name") ?? "the website operator",
    address = value("company.address"),
    email = value("company.privacyEmail") ?? value("company.email"),
    path = privacyPath(s),
    canonical = new URL(path + "/", s.settings.canonicalBaseUrl).href;
  return (
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Privacy Policy — ' +
    e(s.site.name) +
    '</title><meta name="description" content="How we handle inquiry information and privacy choices on this website."><link rel="canonical" href="' +
    e(canonical) +
    '"><link rel="stylesheet" href="/assets/site.css"><script src="/assets/inquiry.js" defer></script></head><body><header><a class="brand" href="/">' +
    e(s.site.name) +
    '</a></header><main id="main"><h1>Privacy Policy</h1><p>This website is operated by ' +
    e(name) +
    "." +
    (address ? " Address: " + e(address) + "." : "") +
    (email
      ? " Privacy contact: " + e(email) + "."
      : " Contact the operator using the published contact information on this website.") +
    '</p><section class="section"><h2>Inquiries and contact information</h2><p>We collect the name, company, email, country, phone or WhatsApp number, selected products, quantity, message and attachments that you choose to submit. We also record the submitting page, referral and campaign information, device category and a first-visit time supplied by your browser. We use this information to respond to your request and manage procurement communications.</p><p>GlobalSite stores inquiries for the website operator. Our chosen hosting and email providers help deliver this service. Where enabled, an AI provider receives a limited, automatically redacted message for spam assessment. Messages are retained even when marked as suspected spam. If the website operator connects GlobalCRM, submitted inquiries and attachments are transferred to that CRM for follow-up. The operator controls this optional connection.</p></section><section class="section"><h2>Security, retention and your choices</h2><p>We use access controls, encryption and anti-abuse checks to protect submitted information. Processing locations depend on the operator and its chosen providers; contact the operator for details. We retain information as needed to handle your request and meet applicable requirements. Contact us to request access, correction or deletion, withdraw consent or ask about retention and transfers. The operator must review the applicable legal basis and local requirements before enabling inquiries.</p><p>When configured, Cloudflare Turnstile checks whether a submission is legitimate. The operator must disclose relevant service providers and processing regions for its deployment.</p></section><section class="section"><h2>Cookies and local storage</h2><p>Necessary functions and your privacy preference are available without optional tracking. We do not load optional analytics or advertising. If you allow optional storage, we may save a first-visit timestamp in your browser. Rejecting optional storage does not prevent submitting an inquiry. Your choice can be changed using Privacy choices below.</p><button type="button" data-cookie-settings>Privacy choices</button></section><p>Policy version: ' +
    e(c.privacyVersion ?? "s6-v1") +
    '</p></main><footer><a href="/">Back to home</a></footer>' +
    renderConsent(s) +
    "</body></html>"
  );
}
