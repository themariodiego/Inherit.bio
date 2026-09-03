/**
 * inherit/no-raw-figure
 *
 * On a result surface, every numeric or genotypic value must be rendered by
 * <Figure>, <RelativeFigure> or <ClaimBlock> (brief §X4: "A lint rule fails
 * the build on any numeric or genotypic value rendered on a result surface
 * outside those components").
 *
 * Reports:
 *  1. JSX text (and a string or template literal inside a JSX expression)
 *     that reads like a figure: `12%`, `A/C`, `in 1,000` (any ladder
 *     denominator). In a template literal each `${…}` counts as a digit, so
 *     `${x}%` is a raw percentage.
 *  2. A JSX expression that is a direct call to `.toFixed(`,
 *     `.toLocaleString(` or `formatPercent(`.
 *
 * Allowed when any ancestor JSX element is named Figure, RelativeFigure or
 * ClaimBlock, or any ancestor JSX element carries a `data-figure-kind`
 * attribute (text inside a figure node is, by construction, figure text).
 *
 * Escape for UI chrome (counts, dates, file sizes): a comment
 *   // inherit-figure-exempt: <reason>
 * (or the JSX form `{/* inherit-figure-exempt: <reason> *\/}`) on the line
 * before the value or on the same line. A reason is required.
 */

/**
 * The result surfaces this rule covers. eslint.config.mjs applies it to every
 * glob here plus src/components/figures/**; nothing is exempt.
 */
export const RESULT_SURFACE_GLOBS = [
  "src/app/(app)/genome/**/*.tsx",
  "src/app/(app)/family/**/*.tsx",
  // The Family domain landing lives in its own route group, because one path
  // serves a public page and a signed-in hub (W9 §1.2).
  "src/app/(family-hub)/**/*.tsx",
  "src/app/(app)/embryos/**/*.tsx",
  "src/components/family/**/*.tsx",
  "src/components/reports/**/*.tsx",
  "src/components/results/**/*.tsx",
];

const PERCENT = /\d+(\.\d+)?\s?%/;
const GENOTYPE = /\b[ACGT]\/[ACGT]\b/;
const DENOMINATOR = /\bin (100|1,000|10,000|100,000|1,000,000)\b/;
const FIGURE_COMPONENTS = new Set(["Figure", "RelativeFigure", "ClaimBlock"]);
const FIGURE_METHODS = new Set(["toFixed", "toLocaleString"]);
const EXEMPT_COMMENT = /^\s*inherit-figure-exempt:\s*\S/;

function looksLikeFigure(text) {
  return PERCENT.test(text) || GENOTYPE.test(text) || DENOMINATOR.test(text);
}

function templateText(node) {
  return node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join("0");
}

function isFigureElement(node) {
  if (node.type !== "JSXElement") return false;
  const { name, attributes } = node.openingElement;
  if (name.type === "JSXIdentifier" && FIGURE_COMPONENTS.has(name.name)) return true;
  return attributes.some(
    (attribute) =>
      attribute.type === "JSXAttribute" &&
      attribute.name.type === "JSXIdentifier" &&
      attribute.name.name === "data-figure-kind",
  );
}

function figureCall(expression) {
  if (expression.type !== "CallExpression") return null;
  const { callee } = expression;
  if (callee.type === "Identifier" && callee.name === "formatPercent") return "formatPercent(";
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier" &&
    FIGURE_METHODS.has(callee.property.name)
  ) {
    return `.${callee.property.name}(`;
  }
  return null;
}

/** @type {import("eslint").Rule.RuleModule} */
const noRawFigure = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Numeric and genotypic values on a result surface must render through Figure, RelativeFigure or ClaimBlock.",
    },
    schema: [],
    messages: {
      rawText:
        "Raw figure text {{text}} outside <Figure>/<RelativeFigure>/<ClaimBlock>. Render it through the figure contract, or add `// inherit-figure-exempt: <reason>` for UI chrome.",
      rawCall:
        "Raw figure call `{{call}}` outside <Figure>/<RelativeFigure>/<ClaimBlock>. Render it through the figure contract, or add `// inherit-figure-exempt: <reason>` for UI chrome.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const exemptLines = new Set(
      sourceCode
        .getAllComments()
        .filter((comment) => EXEMPT_COMMENT.test(comment.value))
        .map((comment) => comment.loc.end.line),
    );

    function isAllowed(node) {
      if (sourceCode.getAncestors(node).some(isFigureElement)) return true;
      for (let line = node.loc.start.line - 1; line <= node.loc.end.line; line++) {
        if (exemptLines.has(line)) return true;
      }
      return false;
    }

    function checkText(node, text) {
      if (!looksLikeFigure(text) || isAllowed(node)) return;
      context.report({
        node,
        messageId: "rawText",
        data: { text: JSON.stringify(text.trim().slice(0, 40)) },
      });
    }

    function insideJsxExpression(node) {
      return sourceCode.getAncestors(node).some((ancestor) => ancestor.type === "JSXExpressionContainer");
    }

    return {
      JSXText(node) {
        checkText(node, node.value);
      },
      Literal(node) {
        if (typeof node.value !== "string") return;
        const parentType = node.parent?.type;
        if (
          parentType === "JSXExpressionContainer" ||
          parentType === "JSXElement" ||
          parentType === "JSXFragment"
        ) {
          checkText(node, node.value);
        }
      },
      TemplateLiteral(node) {
        if (insideJsxExpression(node)) checkText(node, templateText(node));
      },
      JSXExpressionContainer(node) {
        const call = figureCall(node.expression);
        if (call === null || isAllowed(node)) return;
        context.report({ node, messageId: "rawCall", data: { call } });
      },
    };
  },
};

export default noRawFigure;
