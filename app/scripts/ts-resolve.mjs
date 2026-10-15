// Node loader hook: lets Node import the Worker's TypeScript rule files, whose relative imports have no extension.
export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && !/\.[a-z]+$/.test(specifier)) {
    try {
      return await next(specifier + ".ts", context);
    } catch {
      /* fall through */
    }
  }
  return next(specifier, context);
}
