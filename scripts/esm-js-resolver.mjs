/**
 * node 的 ESM 加载器不认 `import ... from '../utils/config'`（vite 认，node 不认）。
 * Step 4 的门要跑**真实的 store 源码**，所以补这一层：相对路径、且没有扩展名时，
 * 先试 `.js`。试不上就交回默认解析，让真正的错误照样冒出来——不藏。
 *
 * 用法：在门里 `register('./esm-js-resolver.mjs', import.meta.url)`，
 * 然后再 `await import('../src/store/xxx.js')`。
 */
export async function resolve(specifier, context, nextResolve) {
  const needsExt = /^\.{1,2}\//.test(specifier)
    && !/\.[A-Za-z][A-Za-z0-9]*$/.test(specifier.split('?')[0])
  if (needsExt) {
    try {
      return await nextResolve(specifier + '.js', context)
    } catch (e) { /* 不是漏扩展名，走默认分支报原错 */ }
  }
  return nextResolve(specifier, context)
}
