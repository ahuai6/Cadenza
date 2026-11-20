import { existsSync, readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { isAbsolute, relative, sep } from 'node:path';
import { createIdResolver, DevEnvironment, parseSync, resolveConfig, Visitor, type AliasOptions } from 'vite';

const normalize = (name: string) => name.split(sep).join('/');

export function references(filename: string, content: string) {
  const { program, errors } = parseSync(filename, content);
  if (errors.length) throw new Error(filename + ': ' + errors.map((error) => error.message).join(', '));
  const result: { specifier: string; line: number; typeOnly: boolean }[] = [];
  function add(
    node: {
      type: string;
      start: number;
      value?: unknown;
      expressions?: readonly unknown[];
      quasis?: readonly { value: { cooked: string | null } }[];
    },
    typeOnly = false,
  ) {
    if (node.type === 'Literal' && typeof node.value === 'string') {
      result.push({ specifier: node.value, line: content.slice(0, node.start).split('\n').length, typeOnly });
    } else if (node.type === 'TemplateLiteral') {
      const text = node.quasis?.[0]?.value.cooked;
      if (node.expressions?.length === 0 && text != null)
        result.push({ specifier: text, line: content.slice(0, node.start).split('\n').length, typeOnly });
    }
  }
  new Visitor({
    ImportDeclaration(node) {
      const typeOnly =
        node.importKind === 'type' ||
        (node.specifiers.length > 0 &&
          node.specifiers.every((item) => item.type === 'ImportSpecifier' && item.importKind === 'type'));
      add(node.source, typeOnly);
    },
    ExportNamedDeclaration(node) {
      const typeOnly =
        node.exportKind === 'type' ||
        (node.specifiers.length > 0 && node.specifiers.every((item) => item.exportKind === 'type'));
      if (node.source) add(node.source, typeOnly);
    },
    ExportAllDeclaration(node) {
      add(node.source, node.exportKind === 'type');
    },
    ImportExpression(node) {
      add(node.source);
    },
    TSImportType(node) {
      add(node.source, true);
    },
    TSImportEqualsDeclaration(node) {
      if (node.moduleReference.type === 'TSExternalModuleReference')
        add(node.moduleReference.expression, node.importKind === 'type');
    },
    CallExpression(node) {
      if (node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments[0])
        add(node.arguments[0]);
    },
  }).visit(program);
  return result;
}

export interface Edge {
  from: string;
  to: string;
  line: number;
  typeOnly: boolean;
}

export async function buildDependencies(files: string[], root: string, alias?: AliasOptions) {
  // Reuse the project's bundler resolver, including tsconfig paths and Vite aliases.
  const config = await resolveConfig(
    { root, configLoader: 'runner', resolve: { tsconfigPaths: true, alias } },
    'serve',
  );
  const environment = new DevEnvironment('client', config, { hot: false });
  const resolveId = createIdResolver(config);
  const edges: Edge[] = [];
  const unresolved: string[] = [];
  for (const name of files) {
    const from = normalize(relative(root, name));
    for (const { specifier, line, typeOnly } of references(name, readFileSync(name, 'utf8'))) {
      if (isBuiltin(specifier) || /^electron(?:\/|$)/.test(specifier)) {
        edges.push({ from, to: specifier, line, typeOnly });
        continue;
      }
      const id = await resolveId(environment, specifier, normalize(name));
      const filename = id?.split('?')[0];
      if (!filename || !isAbsolute(filename) || !existsSync(filename)) {
        if (specifier.startsWith('.') || isAbsolute(specifier)) unresolved.push(from + ':' + line + ' → ' + specifier);
        continue;
      }
      const to = normalize(relative(root, filename));
      if (filename.includes('/node_modules/') || to.startsWith('node_modules/')) continue;
      edges.push({ from, to, line, typeOnly });
    }
  }
  return { edges, unresolved };
}

export function boundaryViolation({ from, to }: Edge, allowed: Record<string, string[]>) {
  if (!to.startsWith('src/')) return 'source must use the platform bridge';
  const [, origin, originGroup] = from.split('/');
  const [, target, targetGroup] = to.split('/');
  if (origin !== target && !allowed[origin]?.includes(target)) return 'layer direction';
  if (origin !== 'app') return null;
  if (target === 'engine' && to !== 'src/engine/index.ts') return 'engine public entry';
  if (target !== 'app') return null;
  const view = (group: string) => ['views', 'ui', 'space'].includes(group);
  if (from !== 'src/app/main.tsx' && !view(originGroup) && view(targetGroup)) return 'application logic imports a view';
  if ((originGroup === 'space' && targetGroup === 'views') || (originGroup === 'views' && targetGroup === 'space'))
    return 'classic and space must use shared code';
  return null;
}

// Tarjan components identify the exact mutually reachable runtime edges; type-only references add no module load.
export function cyclicRuntimeEdges(edges: Edge[]) {
  const graph = new Map<string, Edge[]>();
  for (const edge of edges) {
    if (edge.typeOnly) continue;
    const outgoing = graph.get(edge.from) ?? [];
    outgoing.push(edge);
    graph.set(edge.from, outgoing);
  }
  const visited = new Map<string, number>();
  const active = new Set<string>();
  const stack: string[] = [];
  const cyclic = new Set<string>();
  function visit(name: string): number {
    const index = visited.size;
    let low = index;
    visited.set(name, index);
    active.add(name);
    stack.push(name);
    for (const { to } of graph.get(name) ?? []) {
      if (!visited.has(to)) low = Math.min(low, visit(to));
      else if (active.has(to)) low = Math.min(low, visited.get(to)!);
    }
    if (low === index) {
      const group = stack.splice(stack.lastIndexOf(name));
      for (const member of group) active.delete(member);
      const members = new Set(group);
      for (const member of group) {
        for (const { to } of graph.get(member) ?? []) {
          if (members.has(to)) cyclic.add(`${member} → ${to}`);
        }
      }
    }
    return low;
  }
  for (const name of graph.keys()) if (!visited.has(name)) visit(name);
  return [...cyclic].sort();
}
