# Vue 源码阅读第七天打断点
更新时间：2026-04-21

## 1. 第七天的目标

第七天不要只停留在 `compiler-core` 的抽象层，也不要直接跳进 `.vue` 文件编译。  
今天只做一件事：把 `compiler-dom` 和运行时优化信息接起来，搞清“DOM 平台额外补了什么编译逻辑”以及“patch flag / block tree 最终怎样服务 runtime 更新”。

第七天只围绕下面这条链路读源码：

1. `compiler-dom` 怎样基于 `compiler-core` 再补一层 DOM 专属编译增强
2. `parserOptions` 在 DOM 场景里解决什么问题
3. `transformStyle / transformVHtml / transformVText / transformModel / transformOn` 分别在做什么
4. patch flag 是在哪个阶段被分析出来的
5. `openBlock / createElementBlock / dynamicChildren` 为什么能让 runtime 更新更快

如果你能回答“`compiler-dom` 比 `compiler-core` 多做了什么”和“patch flag 到底怎样帮助 runtime 变快”，第七天就算过关。

## 2. 第七天先不要看什么

先不碰这些内容：

- `compiler-sfc`
- SSR compiler
- 样式预处理器
- `server-renderer`
- `Transition` / `Teleport` / `Suspense`

第七天的重点不是“.vue 文件整体怎么编”，而是“浏览器 DOM 平台给模板编译补了哪些规则，以及这些规则怎样变成 runtime 优化信息”。

## 3. 第七天的主问题

今天只围绕下面五个问题读源码：

1. `compiler-dom` 相比 `compiler-core` 到底多补了什么？
2. 为什么 DOM 平台需要自己的 `parserOptions`？
3. DOM 指令转换为什么不能全放在 `compiler-core`？
4. patch flag 是怎样在编译阶段被分析出来的？
5. block tree / `dynamicChildren` 是怎样把“整树 diff”缩成“只看动态节点”的？

## 3.1 这五个问题的直接答案

### 3.1.1 `compiler-dom` 相比 `compiler-core` 到底多补了什么？

`compiler-core` 解决的是模板编译的通用骨架：parse、transform、codegen。  
`compiler-dom` 则在 `packages/compiler-dom/src/index.ts` 里基于它补了两类东西：

- DOM 平台专属 `parserOptions`
- DOM 平台专属 node / directive transforms

也就是说：

```text
compiler-core
  -> 通用模板编译能力

compiler-dom
  -> 浏览器 DOM 平台专属规则
```

所以第七天要先纠正一个直觉：

`compiler-dom` 不是重新实现一套编译器，而是在通用编译骨架上补平台差异。

### 3.1.2 为什么 DOM 平台需要自己的 `parserOptions`？

因为浏览器模板不是纯抽象语法，它带着很多 DOM 语义：

- HTML 标签大小写、闭合规则
- void tag
- entity decode
- namespace
- 原生标签与组件的判定

这些规则在 `packages/compiler-dom/src/parserOptions.ts` 里统一提供给 parse 阶段。

所以 parse 虽然在 `compiler-core`，但“怎样理解一段模板字符串”这件事，到了 DOM 平台必须多一层浏览器语义。

### 3.1.3 DOM 指令转换为什么不能全放在 `compiler-core`？

因为像这些指令：

- `v-html`
- `v-text`
- `v-model`
- `v-on`

它们的处理很强依赖 DOM 平台行为。

比如：

- `v-model` 在 input、textarea、checkbox、radio、select 上语义都不同
- `v-on` 在 DOM 平台会涉及事件修饰符与事件名处理
- `v-html` / `v-text` 直接关联 DOM 内容更新方式

所以 `packages/compiler-dom/src/index.ts` 里会注入：

- `DOMNodeTransforms`
- `DOMDirectiveTransforms`

这就是为什么 DOM 指令转换不适合全塞进 `compiler-core`。

### 3.1.4 patch flag 是怎样在编译阶段被分析出来的？

patch flag 的核心工作主要还是在 `compiler-core` 的 `transformElement` 里完成，但第七天你要把它和 runtime 的消费关系接起来。

编译器会在分析 props、text、class、style、动态绑定后，为 vnode codegen 挂上类似信息：

- `TEXT`
- `CLASS`
- `STYLE`
- `PROPS`
- `FULL_PROPS`
- `NEED_PATCH`

这些信息最终会被打印进 render code，运行时拿到 vnode 后就能：

- 少做很多无意义比较
- 只更新真正动态的部分

所以 patch flag 不是 runtime 临时猜出来的，而是编译期提前分析、运行时直接消费。

### 3.1.5 block tree / `dynamicChildren` 是怎样把“整树 diff”缩成“只看动态节点”的？

这是第七天最关键的优化认知。

编译器在生成 render code 时，会插入：

- `openBlock()`
- `createElementBlock(...)`
- `createBlock(...)`

这些 helper。

运行时在 `packages/runtime-core/src/vnode.ts` 里执行这些 helper 时，会建立 block，并把本 block 下的动态子节点收集到 `dynamicChildren`。

于是更新时，runtime 就不一定要从头深遍历整棵树，而是可以在很多场景里直接走：

```text
block
  -> dynamicChildren
  -> 只 patch 动态部分
```

所以 block tree 的核心价值就是：  
把“整棵子树都检查一遍”缩成“只关注编译期已经标出来的动态节点”。

## 4. 推荐最小 demo

第七天建议准备一段带静态节点、动态文本、动态 class、`v-if`、`v-for` 的模板，然后观察编译结果：

```html
<div class="card">
  <h1>static title</h1>
  <p :class="cls">{{ msg }}</p>
  <span v-if="ok">yes</span>
  <ul>
    <li v-for="item in list" :key="item.id">{{ item.text }}</li>
  </ul>
</div>
```

这一段最适合观察：

- 哪些节点是静态的
- 哪些节点会带 patch flag
- 哪些节点会进 block / `dynamicChildren`

## 5. 推荐断点顺序

### 5.1 `packages/compiler-dom/src/index.ts`

重点看：

- `compile`
- `parse`
- `DOMNodeTransforms`
- `DOMDirectiveTransforms`

先确认 `compiler-dom` 是怎样在 `compiler-core` 之上追加平台规则的。

### 5.2 `packages/compiler-dom/src/parserOptions.ts`

重点看：

- DOM parse 相关配置

这一步不用深抠所有 HTML 细节，只要先看懂：  
为什么 DOM 平台需要比 `compiler-core` 更多的 parse 语义。

### 5.3 `packages/compiler-dom/src/transforms/transformStyle.ts`

重点看：

- `transformStyle`

这里主要确认：

- DOM 风格的静态 style 是怎样被归一化处理的

### 5.4 `packages/compiler-dom/src/transforms/vHtml.ts`

重点看：

- `transformVHtml`

看懂：

- `v-html` 为什么必须在编译期就改写成特定 props / children 语义

### 5.5 `packages/compiler-dom/src/transforms/vText.ts`

重点看：

- `transformVText`

确认：

- `v-text` 怎样改写成运行时更容易消费的形式

### 5.6 `packages/compiler-dom/src/transforms/vModel.ts`

重点看：

- `transformModel`

这是第七天最值得细看的 DOM 指令转换之一，因为它能把“平台专属编译”这件事体现得最明显。

### 5.7 `packages/compiler-dom/src/transforms/vOn.ts`

重点看：

- `transformOn`

这里主要确认：

- 事件相关编译增强为什么要放在 DOM 平台层

### 5.8 回看 `compiler-core` 与 `runtime-core`

最后回看这些位置，把优化链路接起来：

- `compiler-core/src/transforms/transformElement.ts`
- `compiler-core/src/runtimeHelpers.ts`
- `runtime-core/src/vnode.ts`
- `runtime-core/src/renderer.ts`

重点确认：

- patch flag 是在哪里生成的
- block helper 是怎样接到 `dynamicChildren` 的
- runtime 怎样消费这些优化信息

## 6. 第七天你应该重点观察到的事实

### 6.1 `compiler-dom` 是“通用编译骨架 + DOM 平台补丁”

而不是一套平行编译器。

### 6.2 DOM 平台需要额外 parse 规则和指令转换

因为浏览器模板语义比抽象模板语义更具体。

### 6.3 patch flag 来自编译期分析

runtime 只是消费它。

### 6.4 block tree 的价值在于收窄更新范围

而不是“换一种 vnode 表示法”。

### 6.5 `dynamicChildren` 是编译优化和 runtime diff 之间的桥

这是第七天最重要的连接点。

## 7. 推荐记录方式

第七天建议至少沉淀这三份输出。

### 7.1 一张编译分层图

```text
compiler-core
  -> 通用编译
compiler-dom
  -> DOM 平台增强
```

### 7.2 一张 patch flag 来源图

```text
template
  -> transformElement
  -> patchFlag
  -> render code
  -> runtime patch
```

### 7.3 一张 block tree 图

```text
openBlock
  -> createElementBlock
  -> dynamicChildren
  -> optimized patch
```

## 8. 第七天完成标准

当你能回答下面这些问题，第七天就算过关了：

1. `compiler-dom` 比 `compiler-core` 多补了什么？
2. 为什么 DOM 平台需要自己的 `parserOptions`？
3. 为什么 `v-model`、`v-on` 这类转换更适合放在 `compiler-dom`？
4. patch flag 是怎样在编译期生成的？
5. runtime 为什么能根据 patch flag 少做很多无意义比较？
6. `openBlock / createElementBlock` 在优化链路里扮演什么角色？
7. `dynamicChildren` 为什么能缩小更新范围？

## 9. 推荐的第七天阅读顺序

1. `packages/compiler-dom/src/index.ts`
2. `packages/compiler-dom/src/parserOptions.ts`
3. `packages/compiler-dom/src/transforms/transformStyle.ts`
4. `packages/compiler-dom/src/transforms/vHtml.ts`
5. `packages/compiler-dom/src/transforms/vText.ts`
6. `packages/compiler-dom/src/transforms/vModel.ts`
7. `packages/compiler-dom/src/transforms/vOn.ts`
8. 回看 `compiler-core` + `runtime-core` 的优化连接点

## 10. 第八天怎么接

第七天结束后，第八天最自然的衔接就是进入 `compiler-sfc`：

- `.vue` 文件怎样 parse 成 descriptor
- `script setup` 怎样展开
- template / style / script 怎样重新拼成一个组件模块

## 11. 小结

第七天的核心不是背完所有 DOM transforms，而是建立一个稳定认知：

- `compiler-dom` 在通用编译骨架上补平台规则
- patch flag 是编译期静态分析结果
- block tree / `dynamicChildren` 是编译优化接到 runtime 更新的关键桥梁

只要这一层想清楚了，后面再看 `.vue` 文件编译链和 SSR，就不会觉得编译器和运行时是断开的。
