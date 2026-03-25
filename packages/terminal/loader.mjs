// Custom ESM loader to handle file types Node.js doesn't natively support
export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('bun:')) {
    return { url: `data:text/javascript,export default {}`, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
  if (url.endsWith('.scm')) {
    return { format: 'module', shortCircuit: true, source: 'export default ""' };
  }
  if (url.endsWith('.wasm')) {
    return { format: 'module', shortCircuit: true, source: 'export default null' };
  }
  return nextLoad(url, context);
}
