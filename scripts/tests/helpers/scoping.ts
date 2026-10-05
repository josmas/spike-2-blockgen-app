import * as acorn from 'acorn';

type N = Record<string, any>;

/**
 * Rewrites a program in the code dialect so it behaves the way the same program
 * would as Blockly blocks: only function parameters are local; every other
 * variable is global (the generator declares them all at the top).
 *
 * With `rename`, each function's own variables are also made unique to that
 * function (merge's `i` becomes `merge__i`), which is what the translator must
 * do so functions do not clobber each other's variables.
 *
 * Output is still dialect code (1-based), so it can be run with runDialect().
 */
export function withBlocklyScoping(code: string, options: {rename: boolean}): string {
  const ast = acorn.parse(code, {ecmaVersion: 'latest', sourceType: 'script'}) as N;
  const edits: Array<[number, number, string]> = [];
  const globals = new Set<string>();

  for (const top of ast.body as N[]) {
    if (top.type !== 'FunctionDeclaration') {
      // Top-level variables stay as they are, but become plain globals.
      const walkTop = (n: unknown): void => {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) return n.forEach(walkTop);
        const node = n as N;
        if (node.type === 'VariableDeclaration') {
          for (const d of node.declarations) globals.add(d.id.name);
          edits.push([node.start, node.start + 3, '']);
        }
        for (const v of Object.values(node)) walkTop(v);
      };
      walkTop(top);
      continue;
    }

    const params = new Set<string>((top.params as N[]).map((p) => p.name));
    const locals = new Set<string>();
    const findLocals = (n: unknown): void => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(findLocals);
      const node = n as N;
      if (node.type === 'VariableDeclaration') {
        for (const d of node.declarations) if (!params.has(d.id.name)) locals.add(d.id.name);
      }
      for (const v of Object.values(node)) findLocals(v);
    };
    findLocals(top.body);

    const renamed = (name: string) => (options.rename ? `${top.id.name}__${name}` : name);
    for (const l of locals) globals.add(renamed(l));

    const rewrite = (n: unknown, parent?: N, key?: string): void => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach((c) => rewrite(c, parent, key));
      const node = n as N;
      if (node.type === 'VariableDeclaration') edits.push([node.start, node.start + 3, '']);
      const isPropertyName = parent?.type === 'MemberExpression' && key === 'property' && !parent.computed;
      if (node.type === 'Identifier' && locals.has(node.name) && !isPropertyName) {
        edits.push([node.start, node.end, renamed(node.name)]);
      }
      for (const [k, v] of Object.entries(node)) rewrite(v, node, k);
    };
    rewrite(top.body, top, 'body');
  }

  let out = code;
  for (const [from, to, text] of edits.sort((a, b) => b[0] - a[0])) {
    out = out.slice(0, from) + text + out.slice(to);
  }
  // An empty "var ;" would be a syntax error, so only declare when there is something.
  return (globals.size ? `var ${[...globals].join(', ')};\n` : '') + out;
}

/** Fixed pseudo-random arrays (lengths 1..12, duplicates and negatives), for property-style tests. */
export function randomArrays(count: number, seed = 12345): number[][] {
  let x = seed;
  const next = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({length: count}, () =>
    Array.from({length: 1 + Math.floor(next() * 12)}, () => Math.floor(next() * 20) - 5),
  );
}
