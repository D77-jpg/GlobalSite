// S35 stage D: deterministic quality-baseline scoring for review runs.
// Every structural score is computed from the frozen page and the isolated
// browser measurements. Subjective scores are merged only when the review run
// actually sent screenshots to a vision model (visualInput=true); otherwise the
// report is labelled "structural" and must not be presented as a visual review.
import type { PageInput } from "../../validators/sites.validator";

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
  sections?: Array<{
    id?: string;
    height?: number;
    words?: number;
    images?: number;
    frame?: string | null;
  }>;
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

export function structuralBaseline(
  page: PageInput,
  metrics: ReadonlyArray<BaselineMetric>,
  pageType: string,
): { scores: BaselineScores; signals: BaselineReport["signals"] } {
  const blocks = page.blocks;
  const desktop = metrics.find((m) => m.width === 1440);
  const firstSection = desktop?.sections?.[0];
  const heroImage =
    typeof firstSection?.images === "number"
      ? firstSection.images > 0
      : blocks.some((b) => b.type === "image" && !!b.assetId);
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

  let credibility = 1;
  if (metricsBlock) credibility += 2;
  if (proofBlock) credibility += 2;

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
