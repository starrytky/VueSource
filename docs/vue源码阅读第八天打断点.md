# Vue 源码阅读第八天打断点
更新时间：2026-04-21

## 1. 第八天的目标

第八天不要再只盯模板编译结果，也不要急着直接看 SSR。  
今天只做一件事：把 `.vue` 单文件组件的编译主链走通，搞清 `compiler-sfc` 怎样把 `script`、`template`、`style` 和 `script setup` 重新拼成可执行模块。

第八天只围绕下面这条链路读源码：

1. `.vue` 文件怎样先被 parse 成 descriptor
2. `compileScript` 怎样处理普通 `<script>` 和 `<script setup>`
3. `defineProps / defineEmits / defineExpose / defineModel` 这类宏为什么能成立
4. `compileTemplate` 怎样接回前两天已经看过的 `compiler-dom`
5. `compileStyle` 怎样处理 scoped style 和 css vars

如果你能回答“为什么 `script setup` 是编译期语法”和“`.vue` 文件最终怎样被拆了又拼回去”，第八天就算过关。

## 2. 第八天先不要看什么

先不碰这些内容：

- bundler 插件细节
- Vite / webpack 集成层
- SSR compiler 深分支
- 样式预处理器所有边角逻辑

第八天的重点不是“构建工具怎么接”，而是 `compiler-sfc` 自己怎样理解一个 `.vue` 文件。

## 3. 第八天的主问题

今天只围绕下面五个问题读源码：

1. `.vue` 文件怎样变成 SFC descriptor？
2. `compileScript` 怎样统一普通 `<script>` 和 `<script setup>`？
3. 为什么 `defineProps / defineEmits / defineModel` 这些 API 本质上是编译期宏？
4. `compileTemplate` 怎样把 template 编译重新接回 `compiler-dom`？
5. scoped style 和 css vars 大概是在什么阶段被处理的？

## 3.1 这五个问题的直接答案

### 3.1.1 `.vue` 文件怎样变成 SFC descriptor？

关键入口在 `packages/compiler-sfc/src/parse.ts` 的 `parse(...)`。

它会把整个 `.vue` 文件源码解析成一个 descriptor，大致包含：

- `template`
- `script`
- `scriptSetup`
- `styles`
- `customBlocks`

所以第八天要先建立一个认知：

`.vue` 文件编译的第一步不是直接产出 render code，而是先把不同区块拆成结构化描述对象。

### 3.1.2 `compileScript` 怎样统一普通 `<script>` 和 `<script setup>`？

关键入口在 `packages/compiler-sfc/src/compileScript.ts` 的 `compileScript(...)`。

它会基于 descriptor 做统一处理：

- 只有普通 `<script>` 时，按 normal script 路径处理
- 有 `<script setup>` 时，做宏分析、绑定收集、setup 展开、默认导出拼接
- 如果 template 需要联动，也会把 template 编译结果接回来

所以第八天要看懂：

`compileScript` 的职责不是“只编 script setup”，而是把脚本部分统一整理成最终组件模块的一致输出。

### 3.1.3 为什么 `defineProps / defineEmits / defineModel` 这些 API 本质上是编译期宏？

因为它们并不是运行时真正执行的普通函数。

你会在 `compiler-sfc/src/script/*` 下看到：

- `defineProps.ts`
- `defineEmits.ts`
- `defineExpose.ts`
- `defineModel.ts`

这些处理逻辑。

含义是：

- 编译器在分析 `<script setup>` 时识别这些宏调用
- 把它们改写成对应的 props / emits / expose / model 运行时代码
- 最终输出代码里通常不会保留原始宏调用

所以第八天一定要建立一个稳定认知：  
`script setup` 宏能成立，不是因为 runtime 特别聪明，而是因为编译器提前把它们翻译掉了。

### 3.1.4 `compileTemplate` 怎样把 template 编译重新接回 `compiler-dom`？

关键入口在 `packages/compiler-sfc/src/compileTemplate.ts` 的 `compileTemplate(...)`。

它会：

- 处理 SFC template 特有选项
- 决定使用 `compiler-dom` 或 SSR compiler
- 调用底层模板编译能力
- 返回 render code、ast、map、errors 等结果

所以第八天要把这条链接起来：

```text
SFC template
  -> compileTemplate
  -> compiler-dom / compiler-ssr
  -> render code
```

也就是说，`compiler-sfc` 自己不是把模板从头再编一遍，而是组织参数后调用前面已经看过的模板编译器。

### 3.1.5 scoped style 和 css vars 大概是在什么阶段被处理的？

关键入口在 `packages/compiler-sfc/src/compileStyle.ts`。

这一层主要负责：

- scoped 选择器重写
- css vars 处理
- 样式编译结果和 source map 输出

所以第八天只要先建立一个认知：

- 模板、脚本、样式在 SFC 里是分开编译的
- 但它们最终会通过统一的 descriptor 和 id 再关联起来

## 4. 推荐最小 demo

第八天建议准备一个最短 `.vue` 例子：

```vue
<script setup>
import { ref } from 'vue'

const count = ref(0)
const title = defineProps<{ title: string }>()
const modelValue = defineModel<number>()
</script>

<template>
  <button class="btn" @click="count++">
    {{ title }} - {{ count }} - {{ modelValue }}
  </button>
</template>

<style scoped>
.btn {
  color: tomato;
}
</style>
```

这一段最适合观察：

- parse 后 descriptor 长什么样
- `script setup` 宏怎样被改写
- template 怎样编译出 render
- scoped style 怎样被带上作用域信息

## 5. 推荐断点顺序

### 5.1 `packages/compiler-sfc/src/parse.ts`

重点看：

- `parse`

先确认：

```text
.vue source
  -> descriptor
```

这是第八天的总入口。

### 5.2 `packages/compiler-sfc/src/compileScript.ts`

这是第八天最核心的文件。

重点看：

- `compileScript`

你要重点观察：

- 普通 script 和 script setup 的合流点
- 宏分析大概插在哪
- 最终默认导出是怎样被组织出来的

### 5.3 `packages/compiler-sfc/src/script/*`

重点看这些宏相关处理：

- `defineProps.ts`
- `defineEmits.ts`
- `defineExpose.ts`
- `defineModel.ts`

第八天不用把所有分支都背下来，但一定要看懂：  
为什么这些 API 本质上是编译期处理，不是运行时普通函数。

### 5.4 `packages/compiler-sfc/src/compileTemplate.ts`

重点看：

- `compileTemplate`

这里主要确认：

- SFC template 是怎样把参数整理后交给底层模板编译器的

### 5.5 `packages/compiler-sfc/src/compileStyle.ts`

重点看：

- `compileStyle`
- `compileStyleAsync`

这里主要确认：

- scoped style 怎样被处理
- 为什么 style 编译需要和 SFC id 保持一致

### 5.6 `packages/compiler-sfc/src/rewriteDefault.ts`

重点看：

- `rewriteDefault`

这一步很适合帮助你理解：

SFC 编译阶段为什么经常需要重写默认导出，才能把 template、script、style 的结果重新拼装起来。

## 6. 第八天你应该重点观察到的事实

### 6.1 `.vue` 文件首先会被拆成 descriptor

这是 SFC 编译的起点。

### 6.2 `compileScript` 负责把脚本部分整理成统一输出

不只是“处理 script setup”。

### 6.3 `script setup` 宏成立的前提是编译期改写

不是 runtime 魔法。

### 6.4 `compileTemplate` 本质上是在调用前面已经看过的模板编译器

只是它站在 SFC 上下文里组织参数。

### 6.5 style 编译和 template / script 编译虽然分开，但最终会靠同一个 SFC id 重新关联

这是 scoped style 能成立的重要前提。

## 7. 推荐记录方式

第八天建议至少沉淀这三份输出。

### 7.1 一张 SFC 编译总图

```text
.vue source
  -> parse
  -> descriptor
  -> compileScript / compileTemplate / compileStyle
  -> 重新拼装模块
```

### 7.2 一张 `script setup` 宏对照表

| 宏 | 编译阶段做什么 |
| --- | --- |
| `defineProps` | 生成 props 定义与绑定信息 |
| `defineEmits` | 生成 emits 定义 |
| `defineExpose` | 生成 expose 逻辑 |
| `defineModel` | 生成 model props / emits / useModel 相关代码 |

### 7.3 一张 descriptor 结构图

```text
descriptor
  -> template
  -> script
  -> scriptSetup
  -> styles
  -> customBlocks
```

## 8. 第八天完成标准

当你能回答下面这些问题，第八天就算过关了：

1. `.vue` 文件怎样先被拆成 descriptor？
2. `compileScript` 怎样统一处理普通 script 和 script setup？
3. 为什么 `defineProps / defineEmits / defineModel` 属于编译期宏？
4. `compileTemplate` 怎样接回 `compiler-dom`？
5. scoped style 是在哪一层被处理的？
6. 为什么 SFC 编译需要一个稳定的 id？
7. `.vue` 文件最终怎样重新拼成一个组件模块？

## 9. 推荐的第八天阅读顺序

1. `packages/compiler-sfc/src/parse.ts`
2. `packages/compiler-sfc/src/compileScript.ts`
3. `packages/compiler-sfc/src/script/defineProps.ts`
4. `packages/compiler-sfc/src/script/defineEmits.ts`
5. `packages/compiler-sfc/src/script/defineExpose.ts`
6. `packages/compiler-sfc/src/script/defineModel.ts`
7. `packages/compiler-sfc/src/compileTemplate.ts`
8. `packages/compiler-sfc/src/compileStyle.ts`
9. `packages/compiler-sfc/src/rewriteDefault.ts`

## 10. 第九天怎么接

第八天结束后，第九天最自然的衔接就是进入：

- `server-renderer`
- `runtime-core/src/hydration.ts`
- 再顺手做一轮 Vue 3.5 重点变化收尾

## 11. 小结

第八天的核心不是把每个宏细节都背下来，而是建立一个稳定认知：

- `.vue` 文件先被拆成 descriptor
- script、template、style 是分开编译的
- `script setup` 宏靠编译期改写成立
- `compiler-sfc` 的职责不是重写一切，而是把这些编译结果重新组织成一个组件模块

只要这一层想清楚了，后面再看 SSR、hydration、3.5 专题，就会有很强的全局视角。
