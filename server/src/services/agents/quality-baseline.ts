// S35 stage D: deterministic quality-baseline scoring for review runs.
// Every structural score is computed from the frozen page and the isolated
// browser measurements. Subjective scores are merged only when the review run
// actually sent screenshots to a vision model (visualInput=true); otherwise the
// report is labelled "structural" and must not be presented as a visual review.
import type { PageInput } from "../../validators/sites.validator";
import { pendingDetail } from "../b2b-template.service";

export const BASELINE_DIMENSIONS = [
  "firstImpression",
  "rhythm",
  "density",
  "credibility",
  "conversion",
] as const;
export type BaselineDimension = (typeof BASELINE_DIMENSIONS)[number];
export type BaselineScores = Record<BaselineDimension, number>;

export type BaselineMetric = {
  width: number;
  overflow?: boolean;
  brokenImages?: number;
  height?: number;
  words?: number;
  blankSections?: number;
  h1Height?: number;
  h1LineHeight?: number;
  /** S35 acceptance fix: <img> elements on the page and "Illustrative" labels. */
  images?: number;
  conceptImages?: number;
  sections?: Array<{
    id?: string;
    height?: number;
    words?: number;
    images?: number;
    /** Images in this section that did not load. */
    broken?: number;
    /** Labelled AI illustrations in this section. */
    concepts?: number;
    frame?: string | null;
  }>;
};

export type ImageAvailability = {
  rendered: number;
  broken: number;
  illustrative: number;
};

export type BaselineImprovement = {
  dimension: BaselineDimension;
  code: string;
  recommendation: string;
};

export type BaselineReport = {
  version: "s35-v1";
  method: "structural" | "structural+visual";
  threshold: number;
  structural: BaselineScores;
  visual: BaselineScores | null;
  scores: BaselineScores;
  total: number;
  belowThreshold: boolean;
  signals: {
    blocks: number;
    heroImage: boolean;
    /** The rendered hero image is a labelled AI illustration. */
    heroIllustrative: boolean;
    /** Images actually loaded by the isolated browser (null for older captures). */
    images: ImageAvailability | null;
    headlineWords: number;
    h1Lines: number | null;
    repeatedNeighbours: number;
    repeatedTones: number;
    metricsBlock: boolean;
    proofBlock: boolean;
    ctaBlock: boolean;
    discoveryBlock: boolean;
  };
  improvements: BaselineImprovement[];
};

const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(n)));
const round1 = (n: number) => Math.round(n * 10) / 10;

export function baselineThreshold(raw = process.env.QUALITY_BASELINE_THRESHOLD) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : 3.5;
}

function hasRefs(b: PageInput["blocks"][number]) {
  return (
    b.refs.length > 0 || (b.items ?? []).some((i) => i.refs.length > 0)
  );
}

/**
 * S35 acceptance fix: image availability from what the isolated browser
 * actually rendered, not from product asset lists. Labelled AI illustrations
 * count as rendered images and are reported separately. Null when the capture
 * predates these measurements.
 */
export function imageAvailability(
  metrics: ReadonlyArray<BaselineMetric>,
): ImageAvailability | null {
  const measured = metrics.filter((m) => typeof m.images === "number");
  if (!measured.length) return null;
  const desktop = measured.find((m) => m.width === 1440) ?? measured[0];
  const broken = Math.max(0, ...metrics.map((m) => m.brokenImages ?? 0));
  return {
    rendered: Math.max(0, (desktop.images ?? 0) - (desktop.brokenImages ?? 0)),
    broken,
    illustrative: desktop.conceptImages ?? 0,
  };
}

const UNAVAILABLE_IMAGE =
  /\b(?:unavailable|not available|broken|fail(?:s|ed)? to load|(?:does|did) not load|not loading|unknown (?:asset|image)s?|not (?:in|part of|found in|listed in|included in|among) (?:the |an? )?(?:selected |supplied |approved )?(?:product )?(?:asset|image|media|photo)s?(?: list| inventory| library)?|missing from (?:the |an? )?(?:selected |supplied )?(?:product )?(?:asset|image|media)s?(?: list| inventory| library)?|not (?:a |an )?(?:selected|supplied|approved) (?:product )?(?:asset|image|photo)s?)/i;

/**
 * S37 §4.7-4: Drops model "imagery" findings claiming images failed to load or
 * are missing from asset lists using structural browser section measurements
 * (matched by blockKey when present, or page-wide only when every rendered
 * image loaded). Critique about cropping, lighting or relevance is always kept.
 */
export function reconcileImageFindings<
  T extends { blockKey?: string | null; code: string; recommendation: string },
>(findings: T[], metrics: ReadonlyArray<BaselineMetric>): T[] {
  const images = imageAvailability(metrics);
  if (!images || images.rendered === 0) return findings;
  const desktop =
    metrics.find((m) => m.width === 1440 && Array.isArray(m.sections)) ??
    metrics.find((m) => Array.isArray(m.sections));
  const sectionByKey = new Map<
    string,
    NonNullable<BaselineMetric["sections"]>[number]
  >();
  for (const sec of desktop?.sections ?? []) {
    if (!sec.id) continue;
    const key = sec.id.replace(/^block-/, "");
    sectionByKey.set(key, sec);
  }
  return findings.filter((f) => {
    if (f.code !== "imagery" || !UNAVAILABLE_IMAGE.test(f.recommendation))
      return true;
    if (f.blockKey) {
      const sec = sectionByKey.get(f.blockKey);
      if (sec) {
        // Keep the finding if this specific section actually has broken or zero images.
        if ((sec.broken ?? 0) > 0 || (sec.images ?? 0) === 0) return true;
        return false;
      }
    }
    return images.broken > 0;
  });
}

export function structuralBaseline(
  page: PageInput,
  metrics: ReadonlyArray<BaselineMetric>,
  pageType: string,
): { scores: BaselineScores; signals: BaselineReport["signals"] } {
  const blocks = page.blocks;
  const desktop = metrics.find((m) => m.width === 1440);
  const firstSection = desktop?.sections?.[0];
  // Rendered hero images count, including labelled AI illustrations.
  const heroImage =
    typeof firstSection?.images === "number"
      ? firstSection.images - (firstSection.broken ?? 0) > 0
      : blocks.some((b) => b.type === "image" && !!b.assetId);
  const heroIllustrative = heroImage && (firstSection?.concepts ?? 0) > 0;
  const headline = page.presentation?.headline ?? page.title;
  const headlineWords = headline.trim().split(/\s+/).filter(Boolean).length;
  const h1Lines =
    desktop?.h1Height && desktop.h1LineHeight
      ? Math.max(1, Math.round(desktop.h1Height / desktop.h1LineHeight))
      : null;

  // Rhythm: adjacent blocks repeating the same form (type or frame) or tone.
  let repeatedNeighbours = 0;
  let repeatedTones = 0;
  for (let i = 1; i < blocks.length; i++) {
    const a = blocks[i - 1],
      b = blocks[i];
    if (
      a.type === b.type ||
      (!!a.design?.frame && a.design.frame === b.design?.frame)
    )
      repeatedNeighbours++;
    if ((a.tone ?? "light") === (b.tone ?? "light")) repeatedTones++;
  }

  const metricsBlock = blocks.some((b) => b.type === "metrics" && hasRefs(b));
  const proofBlock = blocks.some(
    (b) =>
      ["case-study", "evidence", "certifications"].includes(b.type) &&
      hasRefs(b),
  );
  const ctaBlock = blocks.some((b) => b.type === "cta");
  const discoveryBlock = blocks.some((b) =>
    ["product-grid", "category-grid", "showcase"].includes(b.type),
  );

  let firstImpression = 1;
  if (heroImage) firstImpression += 2;
  if (headlineWords > 0 && headlineWords <= 8) firstImpression += 1;
  if (h1Lines !== null ? h1Lines <= 3 : headline.length <= 60)
    firstImpression += 1;

  let rhythm = 5 - repeatedNeighbours - Math.floor(repeatedTones / 2);
  if (blocks.length < 3) rhythm = Math.min(rhythm, 2);

  let density = 5;
  if (pageType === "home" && (blocks.length < 4 || blocks.length > 9))
    density -= 2;
  const sections = desktop?.sections ?? [];
  if (sections.length) {
    const words = sections.reduce((n, s) => n + (s.words ?? 0), 0);
    if (words / sections.length < 25) density -= 1;
    if (sections.some((s) => (s.height ?? 0) > 1800 && (s.words ?? 0) < 100))
      density -= 1;
  }
  if (pageType === "home" && typeof desktop?.words === "number" && desktop.words < 300)
    density -= 1;
  if ((desktop?.blankSections ?? 0) > 0) density -= 1;

  // S37 §1.5: credibility rules are page-type aware so product, category,
  // customization, FAQ and contact pages are scored on the evidence relevant
  // to their buyer decision rather than penalised for lacking home-only bands.
  let credibility = 1;
  if (pageType === "product") {
    const hasSpecs = blocks.some(
      (b) => b.type === "specs" && !!b.table?.rows?.length && hasRefs(b),
    );
    const hasTerms = blocks.some(
      (b) =>
        ["moq", "material", "application", "samples", "packaging"].includes(
          b.key,
        ) &&
        hasRefs(b) &&
        !pendingDetail(b.body),
    );
    const hasOemOrProof =
      blocks.some(
        (b) =>
          ["customization", "evidence", "certifications", "case-study"].includes(
            b.type,
          ) && hasRefs(b),
      ) || blocks.some((b) => b.key === "oem" && hasRefs(b));
    if (hasSpecs) credibility += 2;
    if (hasTerms) credibility += 1;
    if (hasOemOrProof || metricsBlock || proofBlock) credibility += 1;
  } else if (pageType === "category") {
    const hasComparisonOrSourced = blocks.some(
      (b) =>
        ["comparison", "features", "split", "specs"].includes(b.type) &&
        hasRefs(b),
    );
    if (hasComparisonOrSourced) credibility += 2;
    if (
      metricsBlock ||
      proofBlock ||
      blocks.some(
        (b) => ["process", "customization"].includes(b.type) && hasRefs(b),
      )
    )
      credibility += 2;
  } else if (pageType === "customization") {
    const hasCustomSourced = blocks.some(
      (b) => b.type === "customization" && hasRefs(b),
    );
    const hasProcess = blocks.some(
      (b) => b.type === "process" && (b.items?.length ?? 0) > 0,
    );
    if (hasCustomSourced) credibility += 2;
    if (hasProcess || proofBlock || metricsBlock) credibility += 2;
  } else if (pageType === "faq") {
    const hasFaq = blocks.some((b) => b.type === "faq" && b.faq.length > 0);
    const hasSourcedFaq = blocks.some(
      (b) => b.type === "faq" && b.faq.length > 0 && hasRefs(b),
    );
    const hasComparison = blocks.some(
      (b) => ["comparison", "specs", "split"].includes(b.type) && hasRefs(b),
    );
    if (hasSourcedFaq) credibility += 3;
    else if (hasFaq) credibility += 2;
    if (hasComparison || proofBlock) credibility += 1;
  } else if (pageType === "contact") {
    const hasGuidance =
      !!page.presentation?.inquiryHeading ||
      blocks.some(
        (b) =>
          ["process", "text", "faq"].includes(b.type) &&
          (b.body.trim().length > 0 ||
            (b.items?.length ?? 0) > 0 ||
            b.faq.length > 0),
      );
    const hasRefsAny =
      page.refs.length > 0 || blocks.some((b) => hasRefs(b));
    if (hasGuidance) credibility += 3;
    if (hasRefsAny || proofBlock) credibility += 1;
  } else {
    if (metricsBlock) credibility += 2;
    if (proofBlock) credibility += 2;
  }

  let conversion = 1;
  if (page.presentation?.primaryActionLabel) conversion += 1;
  if (ctaBlock) conversion += 1;
  if (discoveryBlock || pageType === "product") conversion += 1;
  if (
    page.presentation?.inquiryHeading ||
    page.presentation?.primaryActionTarget === "inquiry"
  )
    conversion += 1;

  return {
    scores: {
      firstImpression: clamp(firstImpression),
      rhythm: clamp(rhythm),
      density: clamp(density),
      credibility: clamp(credibility),
      conversion: clamp(conversion),
    },
    signals: {
      blocks: blocks.length,
      heroImage,
      heroIllustrative,
      images: imageAvailability(metrics),
      headlineWords,
      h1Lines,
      repeatedNeighbours,
      repeatedTones,
      metricsBlock,
      proofBlock,
      ctaBlock,
      discoveryBlock,
    },
  };
}

const ADVICE: Record<BaselineDimension, { code: string; recommendation: string }> =
  {
    firstImpression: {
      code: "BASELINE_FIRST_IMPRESSION",
      recommendation:
        "Strengthen the first screen: use an approved hero image and a short headline of at most eight words that stays within three lines on desktop.",
    },
    rhythm: {
      code: "BASELINE_RHYTHM",
      recommendation:
        "Alternate section forms and tones: avoid neighbouring sections with the same block type, frame or background tone.",
    },
    density: {
      code: "BASELINE_DENSITY",
      recommendation:
        "Balance information density: keep 5-8 purposeful home sections and remove tall sections that carry little buyer information.",
    },
    credibility: {
      code: "BASELINE_CREDIBILITY",
      recommendation:
        "Add credibility elements backed by confirmed facts: a metrics band and a case study, evidence or certification section.",
    },
    conversion: {
      code: "BASELINE_CONVERSION",
      recommendation:
        "Clarify the conversion path: product discovery, a primary action and a closing call to action that leads to the inquiry form.",
    },
  };

export function baselineReport(
  page: PageInput,
  metrics: ReadonlyArray<BaselineMetric>,
  pageType: string,
  options: {
    visualInput: boolean;
    modelScores?: Partial<BaselineScores> | null;
    threshold?: number;
  },
): BaselineReport {
  const threshold = options.threshold ?? baselineThreshold();
  const { scores: structural, signals } = structuralBaseline(
    page,
    metrics,
    pageType,
  );
  const model = options.modelScores;
  const visual =
    options.visualInput &&
    model &&
    BASELINE_DIMENSIONS.every(
      (d) => typeof model[d] === "number" && model[d]! >= 1 && model[d]! <= 5,
    )
      ? (Object.fromEntries(
          BASELINE_DIMENSIONS.map((d) => [d, clamp(model[d]!)]),
        ) as BaselineScores)
      : null;
  const scores = Object.fromEntries(
    BASELINE_DIMENSIONS.map((d) => [
      d,
      visual ? round1((structural[d] + visual[d]) / 2) : structural[d],
    ]),
  ) as BaselineScores;
  const total = round1(
    BASELINE_DIMENSIONS.reduce((n, d) => n + scores[d], 0) /
      BASELINE_DIMENSIONS.length,
  );
  const belowThreshold = total < threshold;
  const improvements = belowThreshold
    ? BASELINE_DIMENSIONS.filter((d) => scores[d] < Math.max(threshold, 4)).map(
        (d) => ({ dimension: d, ...ADVICE[d] }),
      )
    : [];
  return {
    version: "s35-v1",
    method: visual ? "structural+visual" : "structural",
    threshold,
    structural,
    visual,
    scores,
    total,
    belowThreshold,
    signals,
    improvements,
  };
}

// S36 review fix: the header renders the same links in the desktop nav and in
// the collapsed mobile menu. Older captures listed both copies, which models
// reported as "navigation repeated twice". Review input lists each link once.
export type NavigationLink = { label?: unknown; href?: unknown };
export function uniqueNavigation(links: unknown): NavigationLink[] {
  if (!Array.isArray(links)) return [];
  const seen = new Set<string>();
  const out: NavigationLink[] = [];
  for (const link of links) {
    if (!link || typeof link !== "object") continue;
    const l = link as NavigationLink;
    const key =
      String(l.href ?? "").trim() +
      "\u0000" +
      String(l.label ?? "").trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: l.label, href: l.href });
  }
  return out;
}
/** Browser metrics as sent to the review model (navigation de-duplicated). */
export function reviewBrowserMetrics<T extends object>(
  metrics: ReadonlyArray<T>,
): T[] {
  return metrics.map((m) => {
    const nav = (m as { navigation?: unknown }).navigation;
    return Array.isArray(nav) ? { ...m, navigation: uniqueNavigation(nav) } : m;
  });
}

/** Maps improvements onto existing review finding codes for "refine from review". */
export function baselineFindings(report: BaselineReport) {
  const code: Record<
    BaselineDimension,
    "layout" | "repetition" | "content_thin" | "procurement" | "cta"
  > = {
    firstImpression: "layout",
    rhythm: "repetition",
    density: "content_thin",
    credibility: "procurement",
    conversion: "cta",
  };
  return report.improvements.map((i) => ({
    blockKey: null,
    code: code[i.dimension],
    severity: "warning" as const,
    recommendation: i.recommendation,
  }));
}

/**
 * S37 §3.1: REVIEW_SAMPLE_THRESHOLD (default 4; 0 disables sampling).
 * When a whole-site review exceeds the threshold, full AI review runs on the
 * homepage plus the first representative page of each distinct page type;
 * sibling pages still receive full browser screenshots, metrics, structural
 * baseline scoring and fact/link validation gates.
 */
export function reviewSampleThreshold(
  raw: string | undefined = process.env.REVIEW_SAMPLE_THRESHOLD,
): number {
  const n = Number(raw);
  if (raw === undefined || !raw.trim() || !Number.isInteger(n)) return 4;
  return Math.min(50, Math.max(0, n));
}

export function selectFullReviewKeys(
  units: ReadonlyArray<{ key: string; node?: { type?: string } | null }>,
  threshold = reviewSampleThreshold(),
): Set<string> {
  if (threshold === 0 || units.length <= threshold) {
    return new Set(units.map((u) => u.key));
  }
  const selected = new Set<string>();
  const seenTypes = new Set<string>();
  for (const u of units) {
    const type = u.node?.type ?? "other";
    if (type === "home" || !seenTypes.has(type)) {
      selected.add(u.key);
      seenTypes.add(type);
    }
  }
  return selected;
}
