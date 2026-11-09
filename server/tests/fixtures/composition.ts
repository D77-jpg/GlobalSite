import type { PageInput } from "../../src/validators/sites.validator";
export const compositionCases = [
  {
    subject: "Precision parts",
    brief: "Machined components for engineering buyers comparing process fit.",
    hero: "split",
    typography: "technical",
    palette: "cobalt",
    navigation: "capabilities",
    productLayout: "rows",
    considerations: [
      "Drawing intent",
      "Material selection",
      "Inspection brief",
    ],
  },
  {
    subject: "Contract assembly",
    brief: "Assembly projects for OEM teams evaluating delivery scope.",
    hero: "stacked",
    typography: "sans",
    palette: "graphite",
    navigation: "solutions",
    productLayout: "cards",
    considerations: [
      "Assembly scope",
      "Component interfaces",
      "Acceptance criteria",
    ],
  },
  {
    subject: "Custom packaging",
    brief:
      "Packaging collections for brands comparing structures and finishes.",
    hero: "editorial",
    typography: "sans",
    palette: "clay",
    navigation: "catalogue",
    productLayout: "cards",
    considerations: [
      "Pack structure",
      "Artwork preparation",
      "Sample evaluation",
    ],
  },
  {
    subject: "Glass collections",
    brief: "Glass packaging for brand teams comparing forms and applications.",
    hero: "panorama",
    typography: "editorial",
    palette: "violet",
    navigation: "catalogue",
    productLayout: "gallery",
    considerations: [
      "Container form",
      "Closure compatibility",
      "Presentation context",
    ],
  },
] as const;
export function compositionPage(index: number): PageInput {
  const c = compositionCases[index];
  const block = (
    key: string,
    type: any,
    heading: string,
    body = "",
    items: any[] = [],
  ) => ({
    key,
    type,
    heading,
    body,
    items,
    table: null,
    faq: [],
    assetId: null,
    alt: "",
    refs: [],
  });
  const item = (title: string, body: string) => ({
    title,
    body,
    assetId: null,
    alt: "",
    href: null,
    refs: [],
  });
  const selectionContext = [
    "For an engineering brief, identify the drawing revision and the features that affect fit. Separate nominal dimensions from the tolerances that matter to the assembly. Ask how the proposed material, finish and inspection approach relate to your intended conditions, and record any unresolved questions for technical review before comparing quotations.",
    "For an assembly discussion, define the boundary between purchased components and the work being requested. Identify interfaces, expected documentation and the conditions for acceptance. Explain which parts of the project are already defined and which require clarification so that the scope can be reviewed without assuming unconfirmed services.",
    "For a packaging brief, describe the product being packed and how it will be presented, handled and shipped. Compare structural requirements with artwork and material preferences. Ask which details must be confirmed through a sample review, and keep appearance references separate from measurable requirements that will form part of an order.",
    "For a glass selection, consider container form, filling conditions, closure interfaces and how the pack will be displayed. Ask for compatibility information relevant to the intended contents rather than inferring performance from appearance. Record sample evaluation questions and any documentary requirements before selecting a form for the wider range.",
  ][index];
  return {
    title: c.subject + " | Purchasing guide",
    metaDescription: "Explore the range and prepare a useful purchasing brief.",
    refs: [],
    presentation: {
      navigationLabel: "Home",
      headline: c.subject + " for your next project",
      summary:
        "Explore the available range, compare the details that matter and prepare your purchasing brief.",
      primaryActionLabel: "Discuss your project",
      primaryActionTarget: "inquiry",
      visualStyle: "minimal",
      heroLayout: c.hero,
      density: "comfortable",
      designNotes: c.brief,
      composition: {
        version: "v1",
        typography: c.typography,
        palette: c.palette,
        navigation: c.navigation,
        productLayout: c.productLayout,
      },
    },
    blocks: [
      block(
        "range",
        "product-grid",
        "Explore " + c.subject.toLowerCase(),
        "Open the relevant product information and save the items that match your project. Include the selected product names when preparing an inquiry so the discussion starts with the right range.",
      ),
      block(
        "selection",
        "features",
        "Define the details that matter",
        "",
        c.considerations.map((title, i) =>
          item(
            title,
            [
              "Describe the intended use and operating context. Include drawings, reference photographs or a purchasing brief where available, and identify which requirements are essential before comparing the available options.",
              "Compare the published information against your intended application. Ask for written clarification of any missing detail rather than assuming that a similar appearance means the same specification or suitability.",
              "Record the conditions you want to assess before committing to an order. Share your review criteria and ask which supporting information can be provided for the selected product and destination market.",
            ][i],
          ),
        ),
      ),
      block(
        "application",
        "split",
        "Connect the product to your application",
        "A useful comparison starts with the environment in which the product will be used. Explain how it fits into your existing range or project, including any interfaces, presentation requirements and handling conditions that influence selection. Distinguish essential requirements from preferences so the inquiry can focus on suitability rather than appearance alone. " +
          selectionContext,
      ),
      block("brief", "process", "Prepare a focused inquiry", "", [
        item(
          "Choose the relevant range",
          "Review the product pages and list the items you want to discuss. Include application context and any constraints that may affect selection.",
        ),
        item(
          "Attach your requirements",
          "Share the drawings, reference material or specification questions relevant to your brief. Highlight details that still need written confirmation.",
        ),
        item(
          "Review before ordering",
          "Ask for a documented proposal covering the selected products and purchasing conditions. Confirm suitability and outstanding details before making an order decision.",
        ),
      ]),
      block(
        "action",
        "cta",
        "Start with your project brief",
        "Use the inquiry form to share your selection and the questions that remain. A clear brief helps focus the discussion on the information your buying team needs.",
        [{ ...item("Discuss your project", ""), href: "#inquiry" }],
      ),
    ],
  };
}
