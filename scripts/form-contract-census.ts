import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * What every `<form>` in the shipped app actually sends, read from source,
 * and every other request the browser makes (`clientModules`, `fileRequests`).
 *
 * G8.5 asks that every form endpoint's register disposition match its live
 * behaviour. A native form with an `action` is a request the browser builds
 * from markup; an actionless form is a request its submit handler builds with
 * `fetch`. Both are read here by walking the TypeScript syntax tree, never by
 * running anything, and both are reduced to the same shape: the target, the
 * method, the header names, the body's keys and the response statuses the
 * code branches on. `scripts/form-register-correspondence.test.ts` holds that
 * shape against `docs/route-register.json`.
 *
 * The reader resolves only what the source states: string and template
 * literals, the typed `route("id")` helper, `const` bindings in scope, a
 * function's parameters bound to the arguments of the call being followed
 * (in the same file, or a named function import from a local module),
 * conditional expressions (as alternatives) and named string constants
 * exported by a local module. A component that hands its submission to a
 * prop is read through every JSX usage that supplies that prop. Anything else
 * is reported as unresolved rather than guessed, so a request the reader
 * cannot see fails the test until a reviewer records it.
 */

export type RequestTarget =
  | { kind: "path"; path: string }
  | { kind: "route"; id: string }
  | { kind: "unresolved"; text: string };

/** One alternative object: its keys, whether each is always sent, and nested object members. */
export interface BodyShape {
  keys: Record<string, "required" | "optional">;
  /** The literal values a key can carry, where the source states them. */
  values: Record<string, (string | boolean)[]>;
  nested: Record<string, BodyShape[]>;
  /** A spread or key the reader could not resolve, so more keys may be sent. */
  open: boolean;
}

export type RequestBody =
  | { kind: "none" }
  | { kind: "json"; shape: BodyShape }
  | { kind: "unresolved"; text: string };

export interface ClientRequest {
  file: string;
  line: number;
  /** Every place the call can send to (a conditional URL gives several). */
  targets: RequestTarget[];
  /** Every method the call can use; null when the method is not a resolvable string. */
  methods: string[] | null;
  /** Lowercased header names; `resolved` is false when a header object could not be read. */
  headers: { names: string[]; resolved: boolean };
  /** Every body the call can send. */
  bodies: RequestBody[];
  /** Numeric statuses the code compares the response's `status` with. */
  statuses: number[];
  /** How the request was found: a `fetch` call, or a recognised library transport. */
  via: "fetch" | "ai-sdk-default-chat-transport";
}

export interface FormSite {
  file: string;
  line: number;
  /** The exported component the form is rendered by, when it is one. */
  component: string | null;
  /** The native `action` target, or null for an actionless (handler-submitted) form. */
  action: RequestTarget | null;
  /** The native `method` attribute, upper-cased; null when absent or not a literal. */
  method: string | null;
  /** The `name` of every named control inside the form; `(dynamic)` when computed. */
  fields: string[];
  /** Whether the form has an `onSubmit` handler the reader could resolve to a function. */
  handlerResolved: boolean;
  /** The requests the submit handler makes, following local and imported calls. */
  requests: ClientRequest[];
  /** Props of the rendering component that the handler calls. */
  delegatedProps: string[];
}

/**
 * The request body the installed AI SDK's `DefaultChatTransport` sends, read
 * from `node_modules/ai/dist/index.js` (ai 7.0.83): `{ ...body, id, messages,
 * trigger, messageId }`, POST, `Content-Type: application/json`. The test pins
 * the literal it was read from, so an SDK upgrade cannot change it silently.
 */
export const AI_SDK_CHAT_BODY_KEYS = { id: "required", messages: "required", trigger: "required", messageId: "optional" } as const;

type Value =
  | { k: "str"; values: string[] }
  | { k: "tpl"; pattern: string }
  | { k: "route"; id: string }
  | { k: "obj"; node: ts.ObjectLiteralExpression; env: Env }
  | { k: "alt"; options: Value[] }
  | { k: "fn"; node: ts.FunctionLikeDeclaration; env: Env }
  | { k: "param"; name: string }
  | { k: "nothing" }
  | { k: "unknown"; text: string };

type Env = ReadonlyMap<string, { expression: ts.Expression; env: Env }>;
const EMPTY: Env = new Map();
const MAX_DEPTH = 12;
/** At most this many alternative bodies from one object; beyond it, keys fold to optional. */
const MAX_ALTERNATIVES = 32;

const emptyShape = (): BodyShape => ({ keys: {}, values: {}, nested: {}, open: false });

/** A property's literal value, when the source states one: a string, or `true`/`false`. */
function literalValues(initializer: ts.Expression, resolved: Value | null): (string | boolean)[] | null {
  const bare = unwrap(initializer);
  if (bare.kind === ts.SyntaxKind.TrueKeyword) return [true];
  if (bare.kind === ts.SyntaxKind.FalseKeyword) return [false];
  return resolved?.k === "str" ? resolved.values : null;
}

export type SourceReader = (file: string) => string | null;

export function diskReader(root = "."): SourceReader {
  return (file) => {
    try { return readFileSync(path.join(root, file), "utf8"); } catch { return null; }
  };
}

/** Parse caches keyed by file and text, so planted sources never see a stale tree. */
const documents = new Map<string, { text: string; parsed: ts.SourceFile }>();

function parse(file: string, text: string): ts.SourceFile {
  const cached = documents.get(file);
  if (cached && cached.text === text) return cached.parsed;
  const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  documents.set(file, { text, parsed });
  return parsed;
}

function unwrap(expression: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression) || ts.isSatisfiesExpression(expression)
    || ts.isNonNullExpression(expression) || ts.isAwaitExpression(expression)) expression = expression.expression;
  return expression;
}

function isExported(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function localModule(fromFile: string, specifier: string, read: SourceReader): string | null {
  const base = specifier.startsWith("@/") ? `src/${specifier.slice(2)}`
    : /^\.\.?\//.test(specifier) ? path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier)) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (/\.(ts|tsx)$/.test(candidate) && read(candidate) !== null) return candidate;
  }
  return null;
}

/** Read one file's forms and the requests their handlers make. */
export function formSites(file: string, read: SourceReader): FormSite[] {
  const text = read(file);
  if (text === null) return [];
  const document = parse(file, text);
  const reader = new Reader(read);
  const sites: FormSite[] = [];
  const visit = (node: ts.Node) => {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    if (opening && opening.tagName.getText(document) === "form") {
      sites.push(reader.form(node as ts.JsxElement | ts.JsxSelfClosingElement, opening));
    }
    ts.forEachChild(node, visit);
  };
  visit(document);
  return sites;
}

/**
 * The requests made by every function passed as `prop` to `component` across
 * `files`, for a form that delegates its submission to a prop. Each usage is
 * returned with the file it is in, so a usage that makes no request is visible.
 */
export function propSubmissions(component: string, componentFile: string, prop: string, files: string[],
  read: SourceReader): { file: string; line: number; resolved: boolean; requests: ClientRequest[] }[] {
  const reader = new Reader(read);
  const found: { file: string; line: number; resolved: boolean; requests: ClientRequest[] }[] = [];
  for (const file of files) {
    const text = read(file);
    if (text === null || !text.includes(component)) continue;
    const document = parse(file, text);
    const imported = document.statements.some(statement => ts.isImportDeclaration(statement)
      && ts.isStringLiteral(statement.moduleSpecifier)
      && localModule(file, statement.moduleSpecifier.text, read) === componentFile
      && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
      && statement.importClause.namedBindings.elements.some(element => element.name.text === component));
    if (!imported) continue;
    const visit = (node: ts.Node) => {
      const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
      if (opening && opening.tagName.getText(document) === component) {
        const attribute = opening.attributes.properties.find((property): property is ts.JsxAttribute =>
          ts.isJsxAttribute(property) && property.name.getText(document) === prop);
        const expression = attribute?.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : undefined;
        const value = expression ? reader.value(expression, EMPTY, 0) : null;
        found.push({
          file,
          line: document.getLineAndCharacterOfPosition(opening.getStart(document)).line + 1,
          resolved: value?.k === "fn",
          requests: value?.k === "fn" ? reader.requestsIn(value.node, value.env, new Set()) : [],
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(document);
  }
  return found;
}

/**
 * The `fetch` call a transport's custom `fetch` setting makes, when the
 * setting only forwards the transport's own request: a function whose first
 * two parameters are passed, unchanged and in order, to one `fetch` call. That
 * call is the transport's request (read by `transportRequest`), not another one.
 */
export function fetchForwarder(setting: ts.Node): ts.CallExpression | null {
  if (!ts.isArrowFunction(setting) && !ts.isFunctionExpression(setting)) return null;
  const [input, init] = setting.parameters;
  if (!input || !init || !ts.isIdentifier(input.name) || !ts.isIdentifier(init.name)) return null;
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(unwrap(node.expression)) && (unwrap(node.expression) as ts.Identifier).text === "fetch") calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(setting.body);
  const [call] = calls;
  if (calls.length !== 1 || call.arguments.length !== 2) return null;
  const [first, second] = call.arguments.map(unwrap);
  return ts.isIdentifier(first) && first.text === (input.name as ts.Identifier).text
    && ts.isIdentifier(second) && second.text === (init.name as ts.Identifier).text ? call : null;
}

/** The forwarded `fetch` calls of every `new DefaultChatTransport({ fetch })` in a file. */
function transportForwardedCalls(document: ts.SourceFile): Set<ts.CallExpression> {
  const forwarded = new Set<ts.CallExpression>();
  const visit = (node: ts.Node) => {
    if (ts.isNewExpression(node) && node.expression.getText(document) === "DefaultChatTransport") {
      const settings = node.arguments?.[0] && unwrap(node.arguments[0]);
      const setting = settings && ts.isObjectLiteralExpression(settings) ? settings.properties.find((candidate): candidate is ts.PropertyAssignment =>
        ts.isPropertyAssignment(candidate) && candidate.name.getText(document) === "fetch") : undefined;
      const call = setting ? fetchForwarder(unwrap(setting.initializer)) : null;
      if (call) forwarded.add(call);
    }
    ts.forEachChild(node, visit);
  };
  visit(document);
  return forwarded;
}

/**
 * Every `fetch` call in one file, each read in the function that makes it
 * with no parameter bound, and every `new DefaultChatTransport({ ... })`. This
 * reaches requests that no `<form>` makes (a button's click handler, an
 * effect), which the form census leaves out; a value that arrives as a
 * parameter reads as unresolved here. A transport's forwarding `fetch` setting
 * is read as the transport's own request.
 */
export function fileRequests(file: string, read: SourceReader): ClientRequest[] {
  const text = read(file);
  if (text === null) return [];
  const document = parse(file, text);
  const reader = new Reader(read);
  const forwarded = transportForwardedCalls(document);
  const found: ClientRequest[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && !forwarded.has(node)) {
      const callee = unwrap(node.expression);
      const name = ts.isIdentifier(callee) ? callee.text
        : ts.isPropertyAccessExpression(callee) && ["window", "globalThis", "self"].includes(callee.expression.getText())
          ? callee.name.text : null;
      if (name === "fetch") found.push(reader.fetchRequest(node));
    }
    if (ts.isNewExpression(node) && node.expression.getText(document) === "DefaultChatTransport") {
      const transport = reader.transportRequest(node);
      if (transport) found.push(transport);
    }
    ts.forEachChild(node, visit);
  };
  visit(document);
  return found;
}

/** Whether a module's source starts with the `"use client"` directive. */
export function isClientEntry(text: string): boolean {
  const document = ts.createSourceFile("entry.tsx", text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const first = document.statements[0];
  return Boolean(first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use client");
}

/**
 * The local modules the browser loads: every `"use client"` module among
 * `files`, and every local module one of them imports for a value,
 * transitively. Type-only imports are not followed, and a module marked
 * `server-only` is never part of it. This is where every client request is
 * made, including the helpers a component calls (a permission row's submit,
 * the upload transport).
 */
export function clientModules(files: string[], read: SourceReader): string[] {
  const seen = new Set<string>();
  const queue = files.filter(file => isClientEntry(read(file) ?? ""));
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    const text = read(file);
    if (text === null || /^\s*import\s+["']server-only["'];?\s*$/mu.test(text)) continue;
    seen.add(file);
    const document = parse(file, text);
    for (const statement of document.statements) {
      if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) || !statement.moduleSpecifier
        || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (clause?.isTypeOnly) continue;
        const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings : null;
        if (clause && !clause.name && named && named.elements.length > 0 && named.elements.every(element => element.isTypeOnly)) continue;
      } else if (statement.isTypeOnly) continue;
      const target = localModule(file, statement.moduleSpecifier.text, read);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return [...seen].sort();
}

class Reader {
  constructor(private readonly read: SourceReader) {}

  form(element: ts.JsxElement | ts.JsxSelfClosingElement, opening: ts.JsxOpeningLikeElement): FormSite {
    const document = opening.getSourceFile();
    const attribute = (name: string) => opening.attributes.properties.find((property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText(document) === name);
    const attributeValue = (name: string): ts.Expression | null => {
      const found = attribute(name);
      if (!found?.initializer) return null;
      if (ts.isStringLiteral(found.initializer)) return found.initializer;
      return ts.isJsxExpression(found.initializer) ? found.initializer.expression ?? null : null;
    };
    const action = attributeValue("action");
    const method = attributeValue("method");
    const methodValue = method ? this.value(method, EMPTY, 0) : null;
    const fields: string[] = [];
    const collect = (node: ts.Node) => {
      const inner = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
      if (inner && inner !== opening) {
        if (inner.tagName.getText(document) === "form") return;
        const named = inner.attributes.properties.find((property): property is ts.JsxAttribute =>
          ts.isJsxAttribute(property) && property.name.getText(document) === "name");
        if (named) {
          const initializer = named.initializer;
          const literal = initializer && ts.isStringLiteral(initializer) ? initializer.text
            : initializer && ts.isJsxExpression(initializer) && initializer.expression
              && (ts.isStringLiteral(initializer.expression) || ts.isNoSubstitutionTemplateLiteral(initializer.expression))
              ? initializer.expression.text : "(dynamic)";
          fields.push(literal);
        }
      }
      ts.forEachChild(node, collect);
    };
    if (ts.isJsxElement(element)) element.children.forEach(collect);
    const handlerExpression = attributeValue("onSubmit");
    const handler = handlerExpression ? this.value(handlerExpression, EMPTY, 0) : null;
    const delegated = new Set<string>();
    const requests = handler?.k === "fn" ? this.requestsIn(handler.node, handler.env, new Set(), delegated) : [];
    let component: string | null = null;
    for (let scope: ts.Node | undefined = opening.parent; scope; scope = scope.parent) {
      if (ts.isFunctionDeclaration(scope) && scope.name && isExported(scope)) { component = scope.name.text; break; }
      if (ts.isVariableDeclaration(scope) && ts.isIdentifier(scope.name) && isExported(scope.parent.parent)) {
        component = scope.name.text; break;
      }
    }
    return {
      file: document.fileName,
      line: document.getLineAndCharacterOfPosition(opening.getStart(document)).line + 1,
      component,
      action: action ? this.target(action, EMPTY)[0] : null,
      method: methodValue?.k === "str" && methodValue.values.length === 1 ? methodValue.values[0].toUpperCase() : null,
      fields: fields.sort(),
      handlerResolved: handler?.k === "fn",
      requests,
      delegatedProps: [...delegated].sort(),
    };
  }

  /** The declaration a name refers to at `at`, searching enclosing scopes outward. */
  private declaration(name: string, at: ts.Node): ts.Node | null {
    for (let scope: ts.Node | undefined = at.parent; scope; scope = scope.parent) {
      if (ts.isFunctionLike(scope)) {
        for (const parameter of (scope as ts.SignatureDeclaration).parameters) {
          if (ts.isIdentifier(parameter.name) && parameter.name.text === name) return parameter;
          if (ts.isObjectBindingPattern(parameter.name)) {
            for (const element of parameter.name.elements) {
              if (ts.isIdentifier(element.name) && element.name.text === name) return element;
            }
          }
        }
      }
      const statements = ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isModuleBlock(scope)
        || ts.isCaseClause(scope) || ts.isDefaultClause(scope) ? scope.statements : null;
      if (!statements) continue;
      for (const statement of statements) {
        if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement;
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration;
            if (ts.isObjectBindingPattern(declaration.name) || ts.isArrayBindingPattern(declaration.name)) {
              for (const element of declaration.name.elements) {
                if (ts.isBindingElement(element) && ts.isIdentifier(element.name) && element.name.text === name) return element;
              }
            }
          }
        }
        if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings
          && ts.isNamedImports(statement.importClause.namedBindings)) {
          for (const specifier of statement.importClause.namedBindings.elements) {
            if (specifier.name.text === name) return specifier;
          }
        }
      }
    }
    return null;
  }

  /** A named export of a local module: a string constant, or a function to follow. */
  private exported(fromFile: string, specifier: string, symbol: string): Value | null {
    const file = localModule(fromFile, specifier, this.read);
    const text = file ? this.read(file) : null;
    if (!file || text === null) return null;
    const document = parse(file, text);
    for (const statement of document.statements) {
      if (!isExported(statement)) continue;
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === symbol) return { k: "fn", node: statement, env: EMPTY };
      if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== symbol || !declaration.initializer) continue;
        const initializer = unwrap(declaration.initializer);
        if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) return { k: "str", values: [initializer.text] };
        if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) return { k: "fn", node: initializer, env: EMPTY };
      }
    }
    return null;
  }

  value(expression: ts.Expression, env: Env, depth: number): Value {
    const node = unwrap(expression);
    const unknown: Value = { k: "unknown", text: node.getText().slice(0, 120) };
    if (depth > MAX_DEPTH) return unknown;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { k: "str", values: [node.text] };
    if (node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === "undefined")) return { k: "nothing" };
    if (ts.isTemplateExpression(node)) {
      return { k: "tpl", pattern: node.head.text + node.templateSpans.map(span => `[*]${span.literal.text}`).join("") };
    }
    if (ts.isObjectLiteralExpression(node)) return { k: "obj", node, env };
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return { k: "fn", node, env };
    if (ts.isConditionalExpression(node)) {
      return this.alternatives([this.value(node.whenTrue, env, depth + 1), this.value(node.whenFalse, env, depth + 1)]);
    }
    if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      || node.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      return this.alternatives([this.value(node.left, env, depth + 1), this.value(node.right, env, depth + 1)]);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return this.alternatives([{ k: "nothing" }, this.value(node.right, env, depth + 1)]);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "route"
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) return { k: "route", id: node.arguments[0].text };
    if (ts.isIdentifier(node)) {
      const bound = env.get(node.text);
      if (bound) return this.value(bound.expression, bound.env, depth + 1);
      const declaration = this.declaration(node.text, node);
      if (!declaration) return unknown;
      if (ts.isFunctionDeclaration(declaration)) return { k: "fn", node: declaration, env: EMPTY };
      if (ts.isParameter(declaration)) return { k: "param", name: node.text };
      if (ts.isBindingElement(declaration)) {
        return ts.isParameter(declaration.parent.parent) ? { k: "param", name: node.text } : unknown;
      }
      if (ts.isVariableDeclaration(declaration) && declaration.initializer
        && declaration.parent.flags & ts.NodeFlags.Const) {
        return this.value(declaration.initializer, env, depth + 1);
      }
      if (ts.isImportSpecifier(declaration)) {
        const specifier = declaration.parent.parent.parent.moduleSpecifier;
        const symbol = (declaration.propertyName ?? declaration.name).text;
        return (ts.isStringLiteral(specifier) ? this.exported(node.getSourceFile().fileName, specifier.text, symbol) : null) ?? unknown;
      }
      return unknown;
    }
    return unknown;
  }

  private alternatives(options: Value[]): Value {
    const flat = options.flatMap(option => option.k === "alt" ? option.options : [option]);
    if (flat.every(option => option.k === "str")) {
      return { k: "str", values: [...new Set(flat.flatMap(option => (option as { values: string[] }).values))] };
    }
    return { k: "alt", options: flat };
  }

  private target(expression: ts.Expression, env: Env): RequestTarget[] {
    const strip = (text: string) => text.split("?")[0].split("#")[0];
    const one = (value: Value): RequestTarget[] => {
      if (value.k === "str") return value.values.map(entry => ({ kind: "path" as const, path: strip(entry) }));
      if (value.k === "tpl") return [{ kind: "path", path: strip(value.pattern) }];
      if (value.k === "route") return [{ kind: "route", id: value.id }];
      if (value.k === "alt") return value.options.flatMap(one);
      return [{ kind: "unresolved", text: expression.getText().slice(0, 120) }];
    };
    return one(this.value(expression, env, 0));
  }

  /** The keys of an object value, as one or more alternative shapes; null when not an object. */
  private shapes(value: Value, depth: number): BodyShape[] | null {
    if (depth > MAX_DEPTH) return null;
    if (value.k === "alt") {
      const all = value.options.filter(option => option.k !== "nothing").map(option => this.shapes(option, depth + 1));
      return all.length && all.every(option => option !== null) ? (all as BodyShape[][]).flat() : null;
    }
    if (value.k !== "obj") return null;
    let shapes: BodyShape[] = [emptyShape()];
    const resolve = (expression: ts.Expression) => this.value(expression, value.env, depth + 1);
    for (const property of value.node.properties) {
      if (ts.isSpreadAssignment(property)) {
        const spread = resolve(property.expression);
        const options = spread.k === "alt" ? spread.options : [spread];
        const sometimes = options.some(option => option.k === "nothing")
          || (options.length > 1 && options.some(option => option.k === "obj" && option.node.properties.length === 0));
        const inner = this.shapes(spread, depth + 1);
        if (!inner) { shapes = shapes.map(shape => ({ ...shape, open: true })); continue; }
        if (inner.length === 1 && !sometimes) {
          shapes = shapes.map(shape => merge(shape, inner[0], "required"));
          continue;
        }
        if (!sometimes && shapes.length * inner.length <= MAX_ALTERNATIVES) {
          // `...(cond ? { a } : { b })`: two different bodies, kept apart so
          // each is held to the registered body it is meant to be.
          shapes = shapes.flatMap(shape => inner.map(option => merge(shape, option, "required")));
          continue;
        }
        // A spread that only sometimes adds keys: a key only some branches add
        // is optional, and a key every branch adds stays as required as those
        // branches made it.
        const branches = sometimes ? [...inner, emptyShape()] : inner;
        const keys = new Set(branches.flatMap(option => Object.keys(option.keys)));
        const folded: BodyShape = { ...emptyShape(), open: branches.some(option => option.open) };
        for (const key of keys) {
          folded.keys[key] = branches.every(option => option.keys[key] === "required") ? "required" : "optional";
          const nested = branches.flatMap(option => option.nested[key] ?? []);
          if (nested.length) folded.nested[key] = nested;
          const values = branches.flatMap(option => option.values[key] ?? []);
          if (values.length && branches.every(option => !(key in option.keys) || option.values[key])) folded.values[key] = [...new Set(values)];
        }
        shapes = shapes.map(shape => merge(shape, folded, "keep"));
        continue;
      }
      const names = property.name ? propertyName(property.name, resolve) : null;
      if (!names) { shapes = shapes.map(shape => ({ ...shape, open: true })); continue; }
      const initializer = ts.isPropertyAssignment(property) ? property.initializer
        : ts.isShorthandPropertyAssignment(property) ? property.name : null;
      const resolved = initializer ? resolve(initializer) : null;
      const nested = resolved ? this.shapes(resolved, depth + 1) : null;
      const literal = initializer ? literalValues(initializer, resolved) : null;
      for (const name of names) {
        shapes = shapes.map(shape => ({
          keys: { ...shape.keys, [name]: names.length > 1 ? "optional" : "required" },
          values: literal ? { ...shape.values, [name]: literal } : shape.values,
          nested: nested ? { ...shape.nested, [name]: nested } : shape.nested,
          open: shape.open,
        }));
      }
    }
    return shapes;
  }

  private headerNames(value: Value, depth: number): { names: string[]; resolved: boolean } {
    if (value.k === "nothing") return { names: [], resolved: true };
    if (value.k === "alt") {
      const all = value.options.map(option => this.headerNames(option, depth + 1));
      return { names: [...new Set(all.flatMap(option => option.names))].sort(), resolved: all.every(option => option.resolved) };
    }
    if (value.k !== "obj") return { names: [], resolved: false };
    const names: string[] = [];
    let resolved = true;
    for (const property of value.node.properties) {
      if (ts.isSpreadAssignment(property)) {
        const inner = this.headerNames(this.value(property.expression, value.env, depth + 1), depth + 1);
        names.push(...inner.names);
        resolved &&= inner.resolved;
        continue;
      }
      const keys = property.name ? propertyName(property.name, expression => this.value(expression, value.env, depth + 1)) : null;
      if (!keys) { resolved = false; continue; }
      names.push(...keys.map(key => key.toLowerCase()));
    }
    return { names: [...new Set(names)].sort(), resolved };
  }

  /** The values an init member can take, including through `...(cond ? { member } : {})`. */
  private members(init: Value, name: string, depth = 0): { expression: ts.Expression | null; env: Env }[] {
    if (depth > MAX_DEPTH) return [];
    if (init.k === "nothing") return [{ expression: null, env: EMPTY }];
    if (init.k === "alt") return init.options.flatMap(option => this.members(option, name, depth + 1));
    if (init.k !== "obj") return [];
    let found: { expression: ts.Expression | null; env: Env }[] = [{ expression: null, env: init.env }];
    for (const property of init.node.properties) {
      if (ts.isPropertyAssignment(property) && propertyName(property.name, () => ({ k: "unknown", text: "" }))?.[0] === name) {
        found = [{ expression: property.initializer, env: init.env }];
      } else if (ts.isShorthandPropertyAssignment(property) && property.name.text === name) {
        found = [{ expression: property.name, env: init.env }];
      } else if (ts.isSpreadAssignment(property)) {
        const inner = this.members(this.value(property.expression, init.env, depth + 1), name, depth + 1);
        const present = inner.filter(entry => entry.expression !== null);
        if (present.length) found = [...present, ...(inner.some(entry => entry.expression === null) ? found : [])];
      }
    }
    return found;
  }

  /** One `fetch` call read with no parameter bound. */
  fetchRequest(call: ts.CallExpression): ClientRequest {
    return this.request(call, EMPTY);
  }

  private request(call: ts.CallExpression, env: Env): ClientRequest {
    const document = call.getSourceFile();
    const [url, init] = call.arguments;
    const initValue: Value = init ? this.value(init, env, 0) : { k: "nothing" };
    const readable = initValue.k === "nothing" || initValue.k === "obj" || initValue.k === "alt";
    let methods: string[] | null = readable ? [] : null;
    for (const member of readable ? this.members(initValue, "method") : []) {
      if (!member.expression) { methods?.push("GET"); continue; }
      const value = this.value(member.expression, member.env, 0);
      if (value.k !== "str") { methods = null; break; }
      methods?.push(...value.values.map(entry => entry.toUpperCase()));
    }
    if (methods) methods = [...new Set(methods)].sort();
    const headerMembers = readable ? this.members(initValue, "headers") : [];
    const headerParts = headerMembers.map(member => member.expression
      ? this.headerNames(this.value(member.expression, member.env, 0), 0) : { names: [], resolved: true });
    const headers = readable
      ? { names: [...new Set(headerParts.flatMap(part => part.names))].sort(), resolved: headerParts.every(part => part.resolved) }
      : { names: [], resolved: false };
    const bodies: RequestBody[] = [];
    for (const member of readable ? this.members(initValue, "body") : [{ expression: init, env }]) {
      if (!member.expression) { bodies.push({ kind: "none" }); continue; }
      const expression = unwrap(member.expression);
      if (ts.isCallExpression(expression) && expression.expression.getText(document) === "JSON.stringify" && expression.arguments[0]) {
        const shapes = this.shapes(this.value(expression.arguments[0], member.env, 0), 0);
        if (shapes) bodies.push(...shapes.map(shape => ({ kind: "json" as const, shape })));
        else bodies.push({ kind: "unresolved", text: expression.getText(document).slice(0, 120) });
      } else {
        bodies.push({ kind: "unresolved", text: expression.getText(document).slice(0, 120) });
      }
    }
    return {
      file: document.fileName,
      line: document.getLineAndCharacterOfPosition(call.getStart(document)).line + 1,
      targets: url ? this.target(url, env) : [{ kind: "unresolved", text: "(no url)" }],
      methods,
      headers,
      bodies,
      statuses: responseStatuses(call),
      via: "fetch",
    };
  }

  /**
   * `sendMessage(...)` from `useChat({ transport: new DefaultChatTransport({ api }) })`:
   * the installed SDK's own POST, with the body it builds (AI_SDK_CHAT_BODY_KEYS).
   */
  private chatTransport(call: ts.CallExpression, name: string): ClientRequest | null {
    const declaration = this.declaration(name, call);
    if (!declaration || !ts.isBindingElement(declaration)) return null;
    const holder = declaration.parent.parent;
    if (!ts.isVariableDeclaration(holder) || !holder.initializer) return null;
    const hook = unwrap(holder.initializer);
    if (!ts.isCallExpression(hook) || hook.expression.getText() !== "useChat") return null;
    const options = hook.arguments[0] && unwrap(hook.arguments[0]);
    if (!options || !ts.isObjectLiteralExpression(options)) return null;
    const transport = options.properties.find((property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && property.name.getText() === "transport");
    const created = transport && unwrap(transport.initializer);
    if (!created || !ts.isNewExpression(created) || created.expression.getText() !== "DefaultChatTransport") return null;
    // Reported where the transport is created, so the form census and the
    // client census name the same request by the same line.
    return this.transportRequest(created);
  }

  /**
   * The request a `new DefaultChatTransport({ ... })` sends.
   * `api` is the target; `headers` (an object, or a function returning one,
   * which the SDK resolves for each request) adds header names; `fetch` is a
   * function that forwards the SDK's own request (`fetchForwarder`). Any other
   * setting leaves the request open.
   */
  transportRequest(created: ts.NewExpression): ClientRequest | null {
    const settings = created.arguments?.[0] && unwrap(created.arguments[0]);
    if (!settings || !ts.isObjectLiteralExpression(settings)) return null;
    const property = (name: string) => settings.properties.find((candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) && candidate.name.getText() === name);
    const api = property("api");
    const extra = settings.properties.some(candidate => !candidate.name || !["api", "headers", "fetch"].includes(candidate.name.getText()));
    const headersSetting = property("headers");
    let headers: { names: string[]; resolved: boolean } = { names: [], resolved: true };
    if (headersSetting) {
      const value = unwrap(headersSetting.initializer);
      const returned = (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) && !ts.isBlock(value.body) ? unwrap(value.body as ts.Expression)
        : ts.isObjectLiteralExpression(value) ? value : null;
      headers = returned && ts.isObjectLiteralExpression(returned)
        ? this.headerNames({ k: "obj", node: returned, env: EMPTY }, 0) : { names: [], resolved: false };
    }
    const fetchSetting = property("fetch");
    const forwards = !fetchSetting || fetchForwarder(unwrap(fetchSetting.initializer)) !== null;
    const document = created.getSourceFile();
    return {
      file: document.fileName,
      line: document.getLineAndCharacterOfPosition(created.getStart(document)).line + 1,
      targets: api ? this.target(api.initializer, EMPTY) : [{ kind: "unresolved", text: "(default /api/chat)" }],
      methods: ["POST"],
      headers: { names: [...new Set(["content-type", ...headers.names])].sort(), resolved: !extra && headers.resolved && forwards },
      bodies: [{ kind: "json", shape: { ...emptyShape(), keys: { ...AI_SDK_CHAT_BODY_KEYS }, open: extra } }],
      statuses: [],
      via: "ai-sdk-default-chat-transport",
    };
  }

  /** Every `fetch` a function makes, following calls to local and imported functions with their arguments bound. */
  requestsIn(fn: ts.FunctionLikeDeclaration, env: Env, visiting: Set<ts.Node>, delegated?: Set<string>): ClientRequest[] {
    if (visiting.has(fn) || visiting.size > MAX_DEPTH || !fn.body) return [];
    visiting.add(fn);
    const found: ClientRequest[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callee = unwrap(node.expression);
        const name = ts.isIdentifier(callee) ? callee.text
          : ts.isPropertyAccessExpression(callee) && ["window", "globalThis", "self"].includes(callee.expression.getText())
            ? callee.name.text : null;
        if (name === "fetch") {
          found.push(this.request(node, env));
        } else if (ts.isIdentifier(callee)) {
          const transport = this.chatTransport(node, callee.text);
          const value = transport ? null : this.value(callee, env, 0);
          if (transport) {
            found.push(transport);
          } else if (value?.k === "fn") {
            const bound = new Map(value.env);
            value.node.parameters.forEach((parameter, index) => {
              if (ts.isIdentifier(parameter.name) && node.arguments[index]) {
                bound.set(parameter.name.text, { expression: node.arguments[index], env });
              }
            });
            found.push(...this.requestsIn(value.node, bound, visiting, delegated));
          } else if (value?.k === "param") {
            delegated?.add(callee.text);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(fn.body);
    visiting.delete(fn);
    return found;
  }
}

function propertyName(name: ts.PropertyName, resolve: (expression: ts.Expression) => Value): string[] | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)
    || ts.isNumericLiteral(name)) return [name.text];
  if (ts.isComputedPropertyName(name)) {
    const value = resolve(name.expression);
    return value.k === "str" ? value.values : null;
  }
  return null;
}

function merge(into: BodyShape, from: BodyShape, mode: "required" | "keep"): BodyShape {
  const keys = { ...into.keys };
  for (const [key, presence] of Object.entries(from.keys)) {
    keys[key] = mode === "required" ? presence : keys[key] === "required" ? "required" : presence;
  }
  const values = { ...into.values };
  for (const key of Object.keys(from.keys)) {
    if (from.values[key]) values[key] = from.values[key];
    else delete values[key];
  }
  return { keys, values, nested: { ...into.nested, ...from.nested }, open: into.open || from.open };
}

/**
 * The statuses the code compares a fetch's response with: `r.status === 202`,
 * `r.status !== 201`, `[401, 404].includes(r.status)` and `case` labels of a
 * `switch (r.status)`, searched in the function that makes the call.
 */
function responseStatuses(call: ts.CallExpression): number[] {
  let holder: ts.Node = call;
  while (holder.parent && (ts.isAwaitExpression(holder.parent) || ts.isParenthesizedExpression(holder.parent))) holder = holder.parent;
  const parent = holder.parent;
  const name = parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) ? parent.name.text
    : parent && ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(parent.left) ? parent.left.text : null;
  if (!name) return [];
  let scope: ts.Node | undefined = call.parent;
  while (scope && !ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
  if (!scope) return [];
  const isStatus = (node: ts.Node) => {
    const bare = ts.isParenthesizedExpression(node) ? node.expression : node;
    return ts.isPropertyAccessExpression(bare) && bare.name.text === "status"
      && ts.isIdentifier(bare.expression) && bare.expression.text === name;
  };
  const statuses = new Set<number>();
  const visit = (node: ts.Node) => {
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(node.operatorToken.kind)) {
      if (isStatus(node.left) && ts.isNumericLiteral(node.right)) statuses.add(Number(node.right.text));
      if (isStatus(node.right) && ts.isNumericLiteral(node.left)) statuses.add(Number(node.left.text));
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "includes"
      && ts.isArrayLiteralExpression(node.expression.expression) && node.arguments[0] && isStatus(node.arguments[0])) {
      for (const element of node.expression.expression.elements) if (ts.isNumericLiteral(element)) statuses.add(Number(element.text));
    }
    if (ts.isSwitchStatement(node) && isStatus(node.expression)) {
      for (const clause of node.caseBlock.clauses) {
        if (ts.isCaseClause(clause) && ts.isNumericLiteral(clause.expression)) statuses.add(Number(clause.expression.text));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return [...statuses].sort((left, right) => left - right);
}

/* ------------------------------------------------------------------------ */
/* Holding what a form sends against what the register declares.            */
/* ------------------------------------------------------------------------ */

export interface RegisterRoute {
  id: string;
  path: string;
  kind?: string;
  auth?: string;
  methods?: string[];
  parameterContract?: unknown;
  queryContract?: unknown;
  requestContract?: unknown;
  methodRequestContracts?: Record<string, unknown>;
  successResponseContract?: unknown;
  methodSuccessResponseContracts?: Record<string, unknown>;
}

export interface RegisterDocument {
  routes: RegisterRoute[];
  requestSchemas?: Record<string, unknown>;
  responseContracts: Record<string, unknown>;
  responseContractBindings: { allEndpoints?: string[]; routes: Record<string, string[]> };
  authContracts: Record<string, unknown>;
  contractDefaults: Record<string, string>;
  mutationSecurityBindings?: { sessionAuthContracts?: Record<string, string> };
}

/** One way a form's request differs from its register entry, as a stable ledger key. */
export interface FormIssue {
  /** The file whose code builds the request (the form's own file for a native form). */
  file: string;
  routeId: string | null;
  method: string | null;
  issue: string;
}

export const formIssueKey = (issue: FormIssue) =>
  `${issue.file} ${issue.routeId ?? "(unregistered)"} ${issue.method ?? "(method?)"}: ${issue.issue}`;

/**
 * Required headers the register makes conditional on one case of a route's
 * body, read from the `-for-the-...` clause of its `requiredHeader` prose. The
 * clause cannot be evaluated mechanically, so each is written out here as the
 * body value it names, and the test holds this table to the register in both
 * directions: a new conditional clause fails until it is added, and an entry
 * whose clause the register no longer carries fails as stale.
 */
export const CONDITIONAL_REQUIRED_HEADERS: Record<string, { clause: string; when: Record<string, string> }> = {
  "api.subject-drafts": {
    clause: "X-Inherit-Operation-Nonce-from-the-invite-page-for-the-path-a-adult-invitation",
    when: { adultFlow: "path-a-own-account" },
  },
  "api.family-acknowledge": {
    clause: "X-Inherit-Operation-Nonce-from-the-portrait-page-for-the-portrait-acknowledgement",
    when: { acknowledgement: "portrait" },
  },
};

const STATE_CHANGING = ["POST", "PUT", "PATCH", "DELETE"];

/** Every concrete form a registered path stands for, with pinned parameters expanded. */
function registeredForms(entry: RegisterRoute): string[] {
  let forms = [entry.path];
  const contract = entry.parameterContract;
  if (contract && typeof contract === "object") {
    for (const [segment, rule] of Object.entries(contract as Record<string, unknown>)) {
      if (!rule || typeof rule !== "object") continue;
      const spec = rule as { enum?: unknown; const?: unknown };
      const values = Array.isArray(spec.enum) ? spec.enum : spec.const !== undefined ? [spec.const] : null;
      const literals = (values ?? []).filter((value): value is string => typeof value === "string");
      if (literals.length) forms = forms.flatMap(form => literals.map(value => form.replace(`[${segment}]`, value)));
    }
  }
  return [...new Set([entry.path, ...forms])];
}

/**
 * The registered route a request path names. A literal segment matches only
 * itself or a dynamic register segment; a `[*]` placeholder (an interpolated
 * value) matches only a dynamic register segment. The most literal match wins.
 */
export function resolveRequestPath(requestPath: string, routes: RegisterRoute[]): RegisterRoute | null {
  const wanted = requestPath.split("/");
  let best: { entry: RegisterRoute; score: number } | null = null;
  for (const entry of routes) {
    for (const form of registeredForms(entry)) {
      const segments = form.split("/");
      if (segments.length !== wanted.length) continue;
      let score = 0;
      const fits = segments.every((segment, index) => {
        const dynamic = /^\[.+\]$/.test(segment);
        if (wanted[index] === "[*]") return dynamic;
        if (!dynamic) { if (segment === wanted[index]) { score += 1; return true; } return false; }
        return true;
      });
      if (fits && (!best || score > best.score)) best = { entry, score };
    }
  }
  return best?.entry ?? null;
}

/** The header names a request contract makes mandatory, the way scripts/route-gate.ts reads them. */
export function requiredHeaderNames(contract: unknown): string[] {
  const shape = contract as { requiredHeaders?: Record<string, unknown>; requiredHeader?: unknown } | undefined;
  const names = Object.keys(shape?.requiredHeaders ?? {});
  if (typeof shape?.requiredHeader === "string") names.push(shape.requiredHeader.split(/-bound-|-from-/)[0]);
  return [...new Set(names.map(name => name.toLowerCase()))];
}

type ClosedBody = Record<string, unknown>;
interface BodyContract { bodies: ClosedBody[] | null; forbiddenFields: string[]; bodyForbidden: boolean; json: boolean }

function bodyContract(contract: unknown, register: RegisterDocument): BodyContract {
  const shape = contract as { closedBody?: ClosedBody; oneOfClosedBodies?: ClosedBody[]; schema?: string;
    forbiddenFields?: string[]; body?: unknown; contentType?: unknown } | undefined;
  const schema = typeof shape?.schema === "string"
    ? register.requestSchemas?.[shape.schema] as { closedBody?: ClosedBody; oneOfClosedBodies?: ClosedBody[]; forbiddenFields?: string[] } | undefined
    : undefined;
  const bodies = shape?.closedBody ? [shape.closedBody] : shape?.oneOfClosedBodies
    ?? (schema?.closedBody ? [schema.closedBody] : schema?.oneOfClosedBodies ?? null);
  return {
    bodies,
    forbiddenFields: [...(shape?.forbiddenFields ?? []), ...(schema?.forbiddenFields ?? [])],
    bodyForbidden: shape?.body === "forbidden",
    json: shape?.contentType === "application/json",
  };
}

/**
 * A registered key the client may leave out: prose that starts `optional`,
 * or one whose requirement is conditional on another field
 * (`required-only-when-…`, `…-required-exactly-when-…`).
 */
const isOptional = (value: unknown) => typeof value === "string"
  && (/^optional\b/.test(value) || /-only-when-|-only-for-|required-exactly-when/.test(value));
const isForbidden = (value: unknown) => value === "forbidden";
/** A nested closed object: a plain object that is not itself a value rule. */
const isNestedBody = (value: unknown): value is ClosedBody => Boolean(value) && typeof value === "object"
  && !Array.isArray(value) && !["const", "enum", "minimum", "maximumFrom", "rule"].some(rule => rule in (value as object));

/** How one sent shape fits one registered closed body. */
interface Misfit { issues: string[]; constMismatches: number; shared: number }

/**
 * What a sent shape lacks or adds against one registered closed body.
 * `declaredAnywhere` is every key some sibling registered body declares: an
 * optional key the source sends only on some branch is not held against this
 * body when a sibling declares it, because which branch sends it is a
 * correlation the static reader cannot see (`...(proposal ? { proposalId } : {})`
 * beside `action: proposal ? "confirm" : "propose"`). A key no registered body
 * declares is always reported.
 *
 * `declaredByEvery` is every key all sibling bodies declare (G8.5, 23 October
 * 2026). A key the source sends only sometimes, where this body requires it,
 * is reported as "may omit" when every sibling declares it too: then no
 * sibling that lacks the key can be the branch that leaves it out, so the
 * request really can go without a field the register requires. Where some
 * sibling does not declare it, the correlation above may explain it and it
 * is not reported.
 */
function bodyMisfit(shape: BodyShape, body: ClosedBody, declaredAnywhere: ReadonlySet<string>, prefix = "",
  declaredByEvery: ReadonlySet<string> = declaredAnywhere): Misfit {
  const issues: string[] = [];
  let constMismatches = 0;
  const declared = Object.keys(body);
  for (const key of Object.keys(shape.keys).sort()) {
    if (!declared.includes(key) || isForbidden(body[key])) {
      if (shape.keys[key] === "optional" && declaredAnywhere.has(key) && !isForbidden(body[key])) continue;
      issues.push(`sends ${prefix}${key}, which the registered body does not declare`);
      continue;
    }
    const rule = body[key] as { const?: unknown; enum?: unknown[] } | undefined;
    const sent = shape.values[key];
    if (sent && rule && typeof rule === "object" && "const" in rule && sent.some(value => value !== rule.const)) {
      constMismatches += 1;
      issues.push(`sends ${prefix}${key}=${sent.map(String).join("|")} where the registered body requires ${String(rule.const)}`);
    } else if (sent && rule && typeof rule === "object" && Array.isArray(rule.enum) && sent.some(value => !rule.enum!.includes(value))) {
      constMismatches += 1;
      issues.push(`sends ${prefix}${key}=${sent.map(String).join("|")} outside the registered values`);
    }
  }
  for (const key of declared.sort()) {
    if (isOptional(body[key]) || isForbidden(body[key])) continue;
    if (!(key in shape.keys)) { issues.push(`omits ${prefix}${key}, which the registered body requires`); continue; }
    if (shape.keys[key] === "optional" && declaredByEvery.has(key)) {
      issues.push(`may omit ${prefix}${key}, which the registered body requires`);
    }
    const nested = shape.nested[key];
    if (nested && isNestedBody(body[key])) {
      const inner = new Set(Object.keys(body[key] as ClosedBody));
      for (const each of nested) issues.push(...bodyMisfit(each, body[key] as ClosedBody, inner, `${prefix}${key}.`).issues);
    }
  }
  if (shape.open) issues.push(`sends ${prefix || "a body "}the census cannot fully resolve`);
  const shared = Object.keys(shape.keys).filter(key => declared.includes(key)).length;
  return { issues: [...new Set(issues)], constMismatches, shared };
}

/** The registered body a misfitting shape was most plausibly meant to be. */
function nearest(misfits: Misfit[]): Misfit {
  return misfits.reduce((best, misfit) => misfit.constMismatches < best.constMismatches
    || (misfit.constMismatches === best.constMismatches && (misfit.shared > best.shared
      || (misfit.shared === best.shared && misfit.issues.length < best.issues.length))) ? misfit : best);
}

/** One shape per combination of a key's literal values, so `action: a | b` is read as two bodies. */
function byLiteralValue(shape: BodyShape): BodyShape[] {
  let shapes = [shape];
  for (const [key, values] of Object.entries(shape.values)) {
    if (values.length < 2 || shapes.length * values.length > MAX_ALTERNATIVES) continue;
    shapes = shapes.flatMap(each => values.map(value => ({ ...each, values: { ...each.values, [key]: [value] } })));
  }
  return shapes;
}

/** Every numeric `status` anywhere inside a contract object. */
function statusesIn(value: unknown, into = new Set<number>(), depth = 0): Set<number> {
  if (depth > 8 || !value || typeof value !== "object") return into;
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (key === "status" && typeof inner === "number") into.add(inner);
    else statusesIn(inner, into, depth + 1);
  }
  return into;
}

/** The statuses the register lets this route answer: its bound responses, its auth contract and the shared ones. */
export function registeredStatuses(entry: RegisterRoute, method: string, register: RegisterDocument): number[] {
  const statuses = new Set<number>();
  const names = new Set([...(register.responseContractBindings.routes[entry.id] ?? []),
    ...(register.responseContractBindings.allEndpoints ?? [])]);
  if (typeof entry.successResponseContract === "string") names.add(entry.successResponseContract);
  for (const value of Object.values(entry.methodSuccessResponseContracts ?? {})) if (typeof value === "string") names.add(value);
  for (const name of names) statusesIn(register.responseContracts[name], statuses);
  const visited = new Set<string>();
  const authChain = (reference: string | undefined) => {
    const name = reference?.startsWith("authContracts.") ? reference.slice("authContracts.".length) : null;
    if (!name || visited.has(name)) return;
    visited.add(name);
    const contract = register.authContracts[name] as { positiveSession?: string } | undefined;
    statusesIn(contract, statuses);
    authChain(contract?.positiveSession);
  };
  authChain(register.contractDefaults[`endpoint:${entry.auth ?? ""}`]);
  if (entry.auth === "authenticated" && STATE_CHANGING.includes(method)) authChain("authContracts.authenticated-mutation-v1");
  return [...statuses].sort((left, right) => left - right);
}

/** Whether the register's CSRF transport applies to this route and method (mutationSecurityBindings.csrfTransport). */
export function csrfHeaderRequired(entry: RegisterRoute, method: string, register: RegisterDocument): boolean {
  if (!STATE_CHANGING.includes(method) || entry.id === "api.embryo-ingest-chunk") return false;
  const sessions = Object.keys(register.mutationSecurityBindings?.sessionAuthContracts ?? {});
  return entry.auth === "authenticated" || sessions.includes(entry.auth ?? "");
}

function requestContractFor(entry: RegisterRoute, method: string): unknown {
  return entry.methodRequestContracts?.[method] ?? entry.requestContract;
}

function resolveTarget(target: RequestTarget, register: RegisterDocument): RegisterRoute | null {
  return target.kind === "route" ? register.routes.find(route => route.id === target.id) ?? null
    : target.kind === "path" ? resolveRequestPath(target.path, register.routes) : null;
}

/** The body-level misfits of one body against one (route, method). */
function bodyIssues(body: RequestBody, entry: RegisterRoute, method: string, headers: string[], register: RegisterDocument): string[] {
  const contract = bodyContract(requestContractFor(entry, method), register);
  if (body.kind === "unresolved") return [`sends a body the census cannot resolve (${body.text})`];
  if (body.kind === "none") {
    if (contract.bodies && contract.bodies.every(candidate => Object.values(candidate).some(value => !isOptional(value) && !isForbidden(value)))) {
      return ["sends no body where the register requires one"];
    }
    return [];
  }
  const issues: string[] = [];
  if (contract.bodyForbidden) issues.push("sends a body the register forbids");
  if (contract.bodies) {
    // A key whose value is one of several literals is several bodies: each
    // is held to the registered body its discriminator selects.
    const declaredAnywhere = new Set(contract.bodies.flatMap(candidate => Object.keys(candidate)));
    const declaredByEvery = new Set([...declaredAnywhere].filter(key => contract.bodies!.every(candidate => key in candidate)));
    for (const shape of byLiteralValue(body.shape)) {
      const fits = contract.bodies.map(candidate => bodyMisfit(shape, candidate, declaredAnywhere, "", declaredByEvery));
      if (!fits.some(misfit => misfit.issues.length === 0)) issues.push(...nearest(fits).issues);
    }
  }
  for (const field of contract.forbiddenFields) {
    if (field in body.shape.keys) issues.push(`sends ${field}, a field the register forbids`);
  }
  if (contract.json && !headers.includes("content-type")) {
    issues.push("sends a JSON body without Content-Type: application/json, so the browser labels it text/plain");
  }
  return issues;
}

/**
 * One request's divergences from the register. A request can name several
 * targets, methods and bodies when its code branches; the branches are
 * correlated in the source (the objection URL goes with the objection body),
 * which a static reader cannot see, so a body passes when it fits ANY
 * (route, method) the request can use, and a (route, method) passes when ANY
 * body fits it. What fails is a body that fits nothing, or a route and method
 * that nothing the request sends can satisfy.
 */
export function requestIssues(request: ClientRequest, register: RegisterDocument): FormIssue[] {
  const issues: FormIssue[] = [];
  const add = (routeId: string | null, method: string | null, issue: string) =>
    issues.push({ file: request.file, routeId, method, issue });
  if (request.methods === null) add(null, null, "uses a method the census cannot resolve");
  if (!request.headers.resolved) add(null, null, "sends headers the census cannot resolve");
  const combos: { entry: RegisterRoute; method: string }[] = [];
  for (const target of request.targets) {
    const entry = resolveTarget(target, register);
    if (!entry) {
      add(null, null, `sends to ${target.kind === "unresolved" ? `an unresolved target (${target.text})`
        : target.kind === "path" ? target.path : target.id}, which no register entry describes`);
      continue;
    }
    for (const method of request.methods ?? []) {
      const declared = entry.methods ?? (entry.kind === "page" ? ["GET"] : []);
      if (!declared.includes(method)) add(entry.id, method, `the register declares ${declared.join("+") || "no method"} for ${entry.id}`);
      else combos.push({ entry, method });
    }
  }
  const headers = request.headers.names;
  const verdicts = request.bodies.map(body => combos.map(combo => bodyIssues(body, combo.entry, combo.method, headers, register)));
  // A body that fits nothing: report it against the (route, method) it comes closest to.
  request.bodies.forEach((_, index) => {
    const misfits = verdicts[index];
    if (!misfits.length || misfits.some(misfit => misfit.length === 0)) return;
    const nearest = misfits.reduce((best, misfit, at) => misfit.length < misfits[best].length ? at : best, 0);
    for (const issue of misfits[nearest]) add(combos[nearest].entry.id, combos[nearest].method, issue);
  });
  combos.forEach((combo, at) => {
    const fitting = request.bodies.filter((_, index) => verdicts[index][at].length === 0);
    if (!fitting.length && request.bodies.length && request.bodies.some((_, index) =>
      verdicts[index].some(misfit => misfit.length === 0))) {
      // Every body fits some other branch and none fits this one.
      const nearest = request.bodies.reduce((best, _, index) => verdicts[index][at].length < verdicts[best][at].length ? index : best, 0);
      for (const issue of verdicts[nearest][at]) add(combo.entry.id, combo.method, issue);
    }
    const contract = requestContractFor(combo.entry, combo.method);
    const conditional = CONDITIONAL_REQUIRED_HEADERS[combo.entry.id];
    for (const header of requiredHeaderNames(contract)) {
      if (headers.includes(header)) continue;
      if (conditional && typeof (contract as { requiredHeader?: unknown })?.requiredHeader === "string"
        && header === requiredHeaderNames({ requiredHeader: conditional.clause })[0]) {
        const applies = request.bodies.some(body => body.kind === "json" && Object.entries(conditional.when)
          .every(([key, value]) => body.shape.values[key]?.includes(value)));
        if (!applies) continue;
      }
      add(combo.entry.id, combo.method, `omits the required header ${header}`);
    }
    if (csrfHeaderRequired(combo.entry, combo.method, register) && !headers.includes("x-inherit-csrf")
      && !requiredHeaderNames(contract).includes("x-inherit-csrf")) {
      add(combo.entry.id, combo.method, "omits X-Inherit-CSRF, which mutationSecurityBindings.csrfTransport requires of this state-changing request");
    }
  });
  if (combos.length) {
    for (const status of request.statuses) {
      if (!combos.some(combo => registeredStatuses(combo.entry, combo.method, register).includes(status))) {
        add(combos[0].entry.id, combos[0].method, `branches on status ${status}, which no response contract of ${combos[0].entry.id} declares`);
      }
    }
  }
  const seen = new Set<string>();
  return issues.filter(issue => { const key = formIssueKey(issue); if (seen.has(key)) return false; seen.add(key); return true; });
}

/** A native form's divergences: the browser builds its request from markup, so it can carry no header. */
export function nativeFormIssues(site: FormSite, register: RegisterDocument): FormIssue[] {
  if (!site.action) return [];
  const issues: FormIssue[] = [];
  const entry = resolveTarget(site.action, register);
  const method = site.method ?? "GET";
  const add = (issue: string) => issues.push({ file: site.file, routeId: entry?.id ?? null, method, issue });
  if (!entry) { add("submits to a target no register entry describes"); return issues; }
  const methods = entry.kind === "page" ? ["GET"] : entry.methods ?? [];
  if (!methods.includes(method)) add(`the register declares ${methods.join("+") || "no method"} for ${entry.id}`);
  if (entry.kind === "page") {
    const closed = (entry.queryContract as { closed?: Record<string, unknown> } | undefined)?.closed;
    for (const field of site.fields) {
      if (!closed || !(field in closed)) add(`submits the field ${field}, which ${entry.id} declares no query contract for`);
    }
    return issues;
  }
  const contract = requestContractFor(entry, method);
  if (bodyContract(contract, register).bodyForbidden && site.fields.length) add("submits named fields to an endpoint whose body the register forbids");
  for (const header of requiredHeaderNames(contract)) {
    add(`cannot send the required header ${header}: a native form submission carries no custom header`);
  }
  if (csrfHeaderRequired(entry, method, register) && !requiredHeaderNames(contract).includes("x-inherit-csrf")) {
    add("cannot send X-Inherit-CSRF, which mutationSecurityBindings.csrfTransport requires: a native form submission carries no custom header");
  }
  return issues;
}
