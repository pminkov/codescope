import { extname } from 'node:path';
import { createHash } from 'node:crypto';
import { Lang, parse, registerDynamicLanguage } from '@ast-grep/napi';
import python from '@ast-grep/lang-python';
import swift from '@ast-grep/lang-swift';
import go from '@ast-grep/lang-go';
import rust from '@ast-grep/lang-rust';
import java from '@ast-grep/lang-java';
import c from '@ast-grep/lang-c';
import cpp from '@ast-grep/lang-cpp';
import csharp from '@ast-grep/lang-csharp';
import ruby from '@ast-grep/lang-ruby';
import kotlin from '@ast-grep/lang-kotlin';
import php from '@ast-grep/lang-php';
import bash from '@ast-grep/lang-bash';

registerDynamicLanguage({ python, swift, go, rust, java, c, cpp, csharp, ruby, kotlin, php, bash });

const languages = new Map([
  ['JavaScript', Lang.JavaScript, 'js jsx mjs cjs'],
  ['TypeScript', Lang.TypeScript, 'ts mts cts'],
  ['TSX', Lang.Tsx, 'tsx'],
  ['Python', 'python', 'py'], ['Swift', 'swift', 'swift'],
  ['Go', 'go', 'go'], ['Rust', 'rust', 'rs'], ['Java', 'java', 'java'],
  ['C', 'c', 'c'], ['C++', 'cpp', 'cpp cc cxx h hpp hh hxx'],
  ['C#', 'csharp', 'cs'], ['Ruby', 'ruby', 'rb'],
  ['Kotlin', 'kotlin', 'kt kts'], ['PHP', 'php', 'php'],
  ['Shell', 'bash', 'sh bash zsh'],
  ['Vue', Lang.TypeScript, 'vue'], ['Svelte', Lang.TypeScript, 'svelte'],
].flatMap(
  // Share each language's grammar between its source extensions.
  ([name, parser, extensions]) => extensions.split(' ').map(
    // Index source suffixes without classifying markup or manifests as code.
    (extension) => [`.${extension}`, { name, parser }],
  ),
));
const otherSource = new Set('.m .mm .fs .ex .exs .erl .lua .dart .clj .cljs .scala .pl .ps1 .r .sql .graphql .gql .proto .tf'.split(' '));
const classKinds = new Set([
  'class_declaration', 'class_definition', 'class', 'class_specifier',
  'struct_specifier', 'struct_item', 'enum_item', 'trait_item',
  'interface_declaration', 'struct_declaration', 'record_declaration',
  'enum_declaration', 'object_declaration', 'trait_declaration',
]);
const functionKinds = new Set([
  'function_declaration', 'function_signature', 'generator_function_declaration', 'function_definition',
  'function_item', 'method_definition', 'method_declaration', 'method_signature',
  'constructor_declaration', 'constructor_signature', 'abstract_method_signature',
  'init_declaration', 'deinit_declaration', 'method', 'singleton_method',
  'local_function_statement', 'secondary_constructor',
]);
const functionValues = new Set(['arrow_function', 'function_expression', 'generator_function']);
const cachedScans = new Map();

// Identify executable and declarative source files, excluding HTML and configuration.
export function isCodeFile(path) {
  const extension = extname(path).toLowerCase();

  return languages.has(extension) || otherSource.has(extension);
}

// Find declaration names without mistaking parameters or body identifiers for names.
function declarationName(node) {
  if (['identifier', 'field_identifier', 'qualified_identifier'].includes(node.kind())) return node.text();
  const name = node.field('name');
  if (name) return name.text();
  if (node.kind() === 'deinit_declaration') return 'deinit';
  if (node.kind() === 'secondary_constructor') return 'constructor';
  const declarator = node.field('declarator');
  if (declarator) return declarationName(declarator);
  const parent = node.parent();
  if (parent?.kind() === 'variable_declarator') return parent.field('name')?.text();
  if (parent?.kind() === 'export_statement') return 'default';

  return node.children().find(
    // Some grammars expose names as direct identifiers instead of named fields.
    (child) => ['identifier', 'field_identifier', 'type_identifier', 'simple_identifier', 'qualified_identifier'].includes(child.kind()),
  )?.text();
}

// Extract named declarations while retaining lexical class and function ownership.
function collectSymbols(root) {
  const symbols = [];
  const typeSymbols = new Map();
  const pendingMethods = [];
  const stack = [{ node: root, target: symbols }];

  // Walk iteratively so deeply nested expressions cannot overflow the JS stack.
  while (stack.length) {
    const { node, target } = stack.pop();
    const kind = node.kind();
    let symbolKind = classKinds.has(kind) ? 'class' : functionKinds.has(kind) ? 'function' : null;
    if (functionValues.has(kind) && node.parent()?.kind() === 'export_statement') symbolKind = 'function';
    let name = symbolKind ? declarationName(node) : null;
    if (['variable_declarator', 'public_field_definition', 'field_definition', 'pair'].includes(kind) &&
        functionValues.has(node.field('value')?.kind())) {
      symbolKind = 'function';
      name = node.field('name')?.text() || node.field('key')?.text();
    }
    // Go methods and Rust impl blocks live outside the type's lexical declaration.
    if (kind === 'type_spec' && ['struct_type', 'interface_type'].includes(node.field('type')?.kind())) {
      symbolKind = 'class';
      name = declarationName(node);
    }
    if (kind === 'impl_item') {
      const owner = node.field('type')?.text();
      const methods = [];
      pendingMethods.push({ owner, methods, line: node.range().start.line + 1 });
      for (const child of node.children().reverse()) stack.push({ node: child, target: methods });
      continue;
    }
    let children = target;
    if (symbolKind && name) {
      const range = node.range();
      const symbol = { name, kind: symbolKind, line: range.start.line + 1,
        endLine: range.end.line + (range.end.column ? 1 : 0), children: [] };
      if (kind === 'method_declaration' && node.field('receiver')) {
        const receiver = node.field('receiver').find({ rule: { kind: 'type_identifier' } });
        pendingMethods.push({ owner: receiver?.text(), methods: [symbol], line: symbol.line });
      } else target.push(symbol);
      if (symbolKind === 'class') typeSymbols.set(name, symbol);
      children = symbol.children;
    }
    for (const child of node.children().reverse()) {
      if (child.isNamed()) stack.push({ node: child, target: children });
    }
  }

  for (const { owner, methods, line } of pendingMethods) {
    if (!owner) {
      symbols.push(...methods);
      continue;
    }
    if (!typeSymbols.has(owner)) {
      const symbol = { name: owner, kind: 'class', line, endLine: line, children: [] };
      typeSymbols.set(owner, symbol);
      symbols.push(symbol);
    }
    typeSymbols.get(owner).children.push(...methods);
  }

  return symbols;
}

// Keep component script line numbers aligned with their original source file.
function componentScript(content) {
  let result = '';
  let position = 0;
  for (const match of content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const start = match.index + match[0].indexOf('>') + 1;
    result += content.slice(position, start).replace(/[^\r\n]/g, ' ') + match[1];
    position = start + match[1].length;
  }

  return result + content.slice(position).replace(/[^\r\n]/g, ' ');
}

// Parse a source file locally and count physical lines without a trailing phantom line.
export function scanCodeFile(path, content) {
  const extension = extname(path).toLowerCase();
  const language = languages.get(extension);
  const key = `${extension}:${createHash('sha256').update(content).digest('hex')}`;
  if (cachedScans.has(key)) return cachedScans.get(key);
  const lines = content ? content.replace(/\r?\n$/, '').split(/\r?\n/) : [];
  const result = { language: language?.name || extension.slice(1).toUpperCase(),
    lines: lines.length, nonBlankLines: lines.filter(
      // Nonblank counts include comments and are labeled explicitly in the UI.
      (line) => line.trim(),
    ).length, symbols: [], status: language ? 'complete' : 'unsupported' };

  if (language) {
    try {
      const source = ['.vue', '.svelte'].includes(extension) ? componentScript(content) : content;
      const root = parse(language.parser, source).root();
      result.symbols = collectSymbols(root);
      if (root.find({ rule: { kind: 'ERROR' } })) result.status = 'partial';
    } catch {
      result.status = 'unavailable';
    }
  }
  if (cachedScans.size >= 500) cachedScans.delete(cachedScans.keys().next().value);
  cachedScans.set(key, result);

  return result;
}

// List only directories with direct source files, preserving their full relative paths.
export function buildCodeScan(tree) {
  const directories = [];
  const stack = [tree];
  while (stack.length) {
    const directory = stack.pop();
    const files = [];
    for (const node of directory.children || []) {
      if (node.type === 'directory') stack.push(node);
      else if (isCodeFile(node.path)) files.push({ path: node.path, name: node.name,
        readable: node.readable, ...(node.codeScan || { lines: null,
          nonBlankLines: null, symbols: [], status: 'unavailable' }) });
    }
    if (files.length) directories.push({ path: directory.path, name: directory.name, files });
  }
  // Keep directory navigation predictable regardless of filesystem enumeration order.
  directories.sort((left, right) => left.path.localeCompare(right.path));

  return { directories };
}
