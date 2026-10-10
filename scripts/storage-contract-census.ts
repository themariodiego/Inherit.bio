import path from "node:path";
import ts from "typescript";

/** An unresolved bucket stays visible and requires an exact ledger entry. It
 * does not establish that a database, provider or environment chose it. */
export const UNRESOLVED_STORAGE_BUCKET = "(database-selected)";
const UNKNOWN = "\0";
const BUCKET = /^[A-Za-z0-9._-]+$/;
const MAX_DEPTH = 24;
const MAX_STRING = 4096;

/** Resolve only immutable local strings and explicit local named exports.
 * Never execute modules, consult environment values, or resolve packages.
 * The caller supplies the complete public source census. */
export function storageBucketsInSource(source: string, file = "src/planted.ts",
  sources: ReadonlyMap<string, string> = new Map()): string[] {
  const documents = new Map<string, ts.SourceFile>();
  const document = (name: string): ts.SourceFile | null => {
    const text = name === file ? source : sources.get(name);
    if (text === undefined) return null;
    let parsed = documents.get(name);
    if (!parsed) {
      parsed = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true,
        name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      documents.set(name, parsed);
    }
    return parsed;
  };
  const localModule = (from: string, specifier: string): string | null => {
    const base = specifier.startsWith("@/") ? `src/${specifier.slice(2)}`
      : /^\.\.?\//.test(specifier) ? path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier)) : null;
    if (!base || base.startsWith("../") || path.posix.isAbsolute(base)) return null;
    const candidates = /\.(?:ts|tsx|js|mjs)$/.test(base) ? [base]
      : [base, ...[".ts", ".tsx", ".js", ".mjs"].map(extension => base + extension),
        ...[".ts", ".tsx", ".js", ".mjs"].map(extension => `${base}/index${extension}`)];
    const found = candidates.filter(name => name === file || sources.has(name));
    return found.length === 1 ? found[0] : null;
  };
  const topLevel = (node: ts.Node) => ts.isVariableDeclaration(node)
    && ts.isVariableDeclarationList(node.parent) && ts.isVariableStatement(node.parent.parent)
    && ts.isSourceFile(node.parent.parent.parent);
  const boundNames = (name: ts.BindingName): string[] => ts.isIdentifier(name) ? [name.text]
    : name.elements.flatMap(element => ts.isOmittedExpression(element) ? [] : boundNames(element.name));
  const unsafeNames = new Map<string, Set<string>>();
  const shadowedOrWritten = (parsed: ts.SourceFile, name: string): boolean => {
    const saved = unsafeNames.get(parsed.fileName);
    if (saved) return saved.has(name);
    const unsafe = new Set<string>();
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && !topLevel(node) || ts.isParameter(node)) {
        for (const bound of boundNames(node.name)) unsafe.add(bound);
      }
      if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node)
        || ts.isClassExpression(node)) && node.name) unsafe.add(node.name.text);
      if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
        && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(node.left)) unsafe.add(node.left.text);
      if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
        && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
        && ts.isIdentifier(node.operand)) unsafe.add(node.operand.text);
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    unsafeNames.set(parsed.fileName, unsafe);
    return unsafe.has(name);
  };
  const unwrap = (expression: ts.Expression): ts.Expression => {
    while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)
      || ts.isTypeAssertionExpression(expression) || ts.isSatisfiesExpression(expression)) expression = expression.expression;
    return expression;
  };
  type Seen = ReadonlySet<string>;
  const exported = (name: string, symbol: string, seen: Seen, depth: number): string | null => {
    const parsed = document(name);
    if (!parsed || depth > MAX_DEPTH) return null;
    const targets: (() => string | null)[] = [];
    for (const statement of parsed.statements) {
      if (ts.isVariableStatement(statement) && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.name.text === symbol) targets.push(() => local(name, symbol, seen, depth + 1));
        }
      }
      if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
        // A wildcard can introduce an ambiguous binding; never guess through it.
        if (!statement.exportClause) return null;
        if (!ts.isNamedExports(statement.exportClause)) continue;
        for (const element of statement.exportClause.elements) {
          if (element.isTypeOnly || element.name.text !== symbol) continue;
          const original = element.propertyName?.text ?? element.name.text;
          const resolvedModule = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
            ? localModule(name, statement.moduleSpecifier.text) : null;
          targets.push(() => statement.moduleSpecifier ? resolvedModule ? exported(resolvedModule, original, seen, depth + 1) : null
            : local(name, original, seen, depth + 1));
        }
      }
    }
    return targets.length === 1 ? targets[0]() : null;
  };
  const local = (name: string, symbol: string, seen: Seen, depth: number): string | null => {
    const parsed = document(name), identity = `${name}:${symbol}`;
    if (!parsed || depth > MAX_DEPTH || seen.has(identity) || shadowedOrWritten(parsed, symbol)) return null;
    const next = new Set([...seen, identity]);
    const bindings: (() => string | null)[] = [];
    for (const statement of parsed.statements) {
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
        if (!boundNames(declaration.name).includes(symbol)) continue;
        bindings.push(() => ts.isIdentifier(declaration.name) && statement.declarationList.flags & ts.NodeFlags.Const
          && declaration.initializer ? expression(name, declaration.initializer, next, depth + 1) : null);
      }
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const clause = statement.importClause, named = clause?.namedBindings;
        if (clause?.name?.text === symbol || named && ts.isNamespaceImport(named) && named.name.text === symbol) bindings.push(() => null);
        if (named && ts.isNamedImports(named)) for (const element of named.elements) {
          if (element.name.text !== symbol) continue;
          const resolvedModule = localModule(name, statement.moduleSpecifier.text);
          bindings.push(() => !clause?.isTypeOnly && !element.isTypeOnly && resolvedModule
            ? exported(resolvedModule, element.propertyName?.text ?? element.name.text, next, depth + 1) : null);
        }
      }
    }
    return bindings.length === 1 ? bindings[0]() : null;
  };
  const expression = (name: string, given: ts.Expression, seen: Seen, depth: number): string | null => {
    if (depth > MAX_DEPTH) return null;
    const value = unwrap(given);
    let result: string | null = null;
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) result = value.text;
    else if (ts.isIdentifier(value)) result = local(name, value.text, seen, depth + 1);
    else if (ts.isTemplateExpression(value)) {
      result = value.head.text;
      for (const span of value.templateSpans) result += (expression(name, span.expression, seen, depth + 1) ?? UNKNOWN) + span.literal.text;
    } else if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      result = (expression(name, value.left, seen, depth + 1) ?? UNKNOWN) + (expression(name, value.right, seen, depth + 1) ?? UNKNOWN);
    }
    return result !== null && result.length <= MAX_STRING ? result : null;
  };
  const property = (value: ts.Expression): { receiver: ts.Expression; name: string | null } | null => {
    value = unwrap(value);
    if (ts.isPropertyAccessExpression(value)) return { receiver: value.expression, name: value.name.text };
    if (ts.isElementAccessExpression(value) && value.argumentExpression) {
      const name = expression(file, value.argumentExpression, new Set(), 0);
      return { receiver: value.expression, name: name && !name.includes(UNKNOWN) ? name : null };
    }
    return null;
  };
  const buckets = new Set<string>();
  const rest = (value: string | null) => {
    if (value === null) return;
    for (const match of value.matchAll(/\/storage\/v1\/object\//g)) {
      let tail = value.slice(match.index + match[0].length);
      tail = tail.replace(/^(?:upload\/sign|authenticated|public|sign|info)\//, "");
      const segment = tail.split("/")[0];
      buckets.add(BUCKET.test(segment) ? segment : UNRESOLVED_STORAGE_BUCKET);
    }
  };
  const parsed = document(file)!;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const method = property(node.expression), receiver = method && property(method.receiver);
      if (method && (method.name === "from" || method.name === null) && receiver?.name === "storage") {
        const bucket = method.name === "from" && node.arguments.length === 1
          ? expression(file, node.arguments[0], new Set(), 0) : null;
        buckets.add(bucket !== null && BUCKET.test(bucket) ? bucket : UNRESOLVED_STORAGE_BUCKET);
      }
      for (const argument of node.arguments) rest(expression(file, argument, new Set(), 0));
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)
      || ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      // Inspect the whole producer, not an incomplete nested URL fragment.
      const parent = node.parent;
      if (!ts.isTemplateSpan(parent) && !ts.isTemplateExpression(parent)
        && !(ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.PlusToken)) {
        const value = expression(file, node, new Set(), 0);
        if (value === null && node.getText(parsed).includes("/storage/v1/object/")) buckets.add(UNRESOLVED_STORAGE_BUCKET);
        else rest(value);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return [...buckets].sort();
}
