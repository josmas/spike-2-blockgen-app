// Module resolution hook that lets Node run the app's TypeScript as written.
//
// Node strips types natively, but the app is written for webpack, which
// resolves things Node does not:
//   1. Relative imports without an extension ("./append" -> "./append.ts").
//   2. `import * as Blockly from 'blockly/core'`. Under Node that resolves to
//      a CommonJS file whose names only appear under `.default`, so
//      `Blockly.Workspace` would be undefined. 'blockly' exposes everything
//      as proper named exports (and also registers the standard blocks).
// Nothing in src/ needs to change for this; see register.mjs.

const isRelative = (specifier) =>
  specifier.startsWith('./') || specifier.startsWith('../');

const hasExtension = (specifier) => /\.[a-z]+$/i.test(specifier);

export async function resolve(specifier, context, nextResolve) {
  const fromDependency = context.parentURL?.includes('/node_modules/');

  if (specifier === 'blockly/core' && !fromDependency) {
    return nextResolve('blockly', context);
  }
  if (isRelative(specifier) && !hasExtension(specifier) && !fromDependency) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // Fall through to the default resolution and its error message.
    }
  }
  return nextResolve(specifier, context);
}
