import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import path from 'path'
import fs from 'fs'

/**
 * ★ 显式注入 uni.scss —— 修 HBuilderX 运行时报
 *   [plugin:vite:css] [sass] Undefined variable.
 *
 * 背景（读源码得出，2026-09-19）：
 *
 * 官方实现在
 *   node_modules/@dcloudio/vite-plugin-uni/dist/config/css.js
 *
 *     function resolveAdditionalData(inputDir, config) {
 *       const uniScssFile = path.resolve(inputDir, 'uni.scss')
 *       if (!fs.existsSync(uniScssFile)) return userAdditionalData   // ← 找不到就静默跳过
 *       ...
 *     }
 *
 * 其中 `inputDir = process.env.UNI_INPUT_DIR`，且
 *   cli/utils.js: function addConfigFile() {
 *     if (isInHBuilderX()) inlineConfig.configFile = resolveConfigFile()
 *   }
 *   resolveConfigFile() 优先取 `${UNI_INPUT_DIR}/vite.config.*`
 *
 * CLI 构建（node_modules/.../uni.js build）把 UNI_INPUT_DIR 设为 `src`，
 * 所以 `src/uni.scss` 找得到 → 正常。
 * 但 **HBuilderX 运行时把 UNI_INPUT_DIR 指向项目根**，于是
 * `path.resolve(根, 'uni.scss')` 找不到（实际在 src/uni.scss）→ 静默不注入
 * → 每个用到 $token 的 <style> 都报 Undefined variable。
 *
 * 修法：不赌 UNI_INPUT_DIR，自己按「候选路径」找到 uni.scss 并作为
 * additionalData 注入。配置文件本身一定读得到（两个入口都是），
 * 以 __dirname 为基准最可靠。
 *
 * 去重说明：官方逻辑是 `uni.scss 内容 + '\n' + userAdditionalData`。
 * 若官方也找到了 uni.scss，而我又注入一份，会变成两份。
 * Sass 里重复 `$var: value` 只是覆盖、不会报错，但会让每个样式块多编译 94 行。
 * 所以这里只在「官方一定找不到」时才注入 —— 判定依据是
 * `UNI_INPUT_DIR/uni.scss` 是否存在。
 */
function findUniScss() {
  const candidates = []
  // 1) HBuilderX/CLI 约定的 inputDir
  if (process.env.UNI_INPUT_DIR) {
    candidates.push(path.resolve(process.env.UNI_INPUT_DIR, 'uni.scss'))
  }
  // 2) 配置文件同级（大多数项目 uni.scss 就在 src/，而 vite.config 在根）
  candidates.push(path.resolve(__dirname, 'src/uni.scss'))
  candidates.push(path.resolve(__dirname, 'uni.scss'))
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return ''
}

function uniScssAdditionalData() {
  const inputDirUniScss = process.env.UNI_INPUT_DIR
    ? path.resolve(process.env.UNI_INPUT_DIR, 'uni.scss')
    : ''

  // 官方已经能找到 → 不重复注入
  if (inputDirUniScss && fs.existsSync(inputDirUniScss)) {
    return ''
  }

  const file = findUniScss()
  if (!file) {
    // 真的找不到：什么都不注入，至少不会把构建搞挂
    return ''
  }
  let content = fs.readFileSync(file, 'utf8')
  // 官方对含 #endif 的条件编译块会先走 preCss，这里保持一致的最小处理
  if (content.includes('#endif')) {
    content = content.replace(/\n?\/\/\s*#ifdef[^\n]*\n?/g, '\n')
      .replace(/\n?\/\/\s*#ifndef[^\n]*\n?/g, '\n')
      .replace(/\n?\/\/\s*#endif[^\n]*\n?/g, '\n')
  }
  return content + '\n'
}

/**
 * H5 版本指纹（配合 src/App.vue 的 checkH5Update）：
 *   构建时生成 dist/version.json（{ t: 构建时间戳 }），并把同一时间戳以
 *   __BUILD_TIME__ 注入运行时代码。App 回前台时比对两者 —— 不一致说明服务器
 *   已换新包，旧标签页跑旧代码调新接口是「莫名报错」的常见来源，提示刷新即可。
 * 只在生产构建 H5 时生效；dev 与小程序构建不产出、不注入（页面用 typeof 兜底）。
 */
function h5VersionStamp() {
  const enabled = () => process.env.UNI_PLATFORM === 'h5' && process.env.NODE_ENV === 'production'
  let t = Date.now()
  return {
    name: 'h5-version-stamp',
    config() {
      if (!enabled()) return
      t = Date.now()
      return { define: { __BUILD_TIME__: JSON.stringify(t) } }
    },
    generateBundle() {
      if (!enabled()) return
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ t }) })
    },
  }
}

export default defineConfig({
  plugins: [uni(), h5VersionStamp()],
  css: {
    preprocessorOptions: {
      scss: {
        charset: false,
        additionalData: uniScssAdditionalData(),
      },
    },
  },
})
