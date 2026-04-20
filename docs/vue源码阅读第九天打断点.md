# Vue 源码阅读第九天打断点
更新时间：2026-04-21

## 1. 第九天的目标

第九天作为这一轮主线收尾，不再单独只看一个包。  
今天分两段完成：

1. 上午把 SSR / hydration 主链走通
2. 下午把当前仓库 `3.5.30` 里值得单独关注的 Vue 3.5 变化做一轮源码落点整理

第九天只围绕下面这两条线读源码：

- `server-renderer`：服务端怎样把 vnode / 组件树输出成 HTML
- `runtime-core/src/hydration.ts`：客户端怎样接管已有 DOM，而不是重新 mount

以及下面这些 3.5 话题：

- `onWatcherCleanup`
- watcher / effect 的 `pause()` / `resume()`
- `defineModel`
- `useTemplateRef`
- lazy hydration strategies

如果你能回答“SSR 和 CSR 的核心差别是什么”和“这些 3.5 新能力分别落在哪个 package”，第九天就算过关。

## 2. 第九天先不要看什么

先不碰这些内容：

- 构建工具 SSR 集成层
- 服务端框架适配
- 所有 e2e 细节
- Vue 2 compat

第九天的重点不是“把所有 SSR 分支读完”，而是建立：

- 服务端渲染和客户端挂载的核心差异
- hydration 为什么不是重新 patch 一棵新树
- Vue 3.5 的新增能力分别落在 runtime、compiler、reactivity 哪一层

## 3. 第九天的主问题

今天只围绕下面五个问题读源码：

1. 服务端渲染时，Vue 是怎样把组件树变成 HTML 字符串的？
2. hydration 和普通客户端 mount 的本质区别是什么？
3. `hydrateNode / hydrateElement / hydrateChildren` 这条链在做什么？
4. lazy hydration strategy 为什么属于 Vue 3.5 值得单独看的能力？
5. `onWatcherCleanup`、`defineModel`、`useTemplateRef` 这些 3.5 能力分别落在哪些模块？

## 3.1 这五个问题的直接答案

### 3.1.1 服务端渲染时，Vue 是怎样把组件树变成 HTML 字符串的？

关键入口在 `packages/server-renderer/src/renderToString.ts` 的 `renderToString(...)`。

它最终会走到：

- `renderComponentVNode(...)`
- `renderVNode(...)`

也就是说，SSR 不是走浏览器 DOM API，而是：

```text
app / vnode
  -> renderComponentVNode
  -> renderVNode
  -> buffer / string
```

所以第九天要先建立一个认知：

- CSR 的目标是创建 / 更新真实 DOM
- SSR 的目标是生成 HTML 字符串或流

### 3.1.2 hydration 和普通客户端 mount 的本质区别是什么？

普通客户端 mount 是：

```text
没有现成 DOM
  -> patch(null, vnode)
  -> 创建整棵 DOM
```

而 hydration 是：

```text
已经有服务端输出的 DOM
  -> hydrate(vnode, container)
  -> 对齐已有 DOM 与 vnode
  -> 绑定组件实例、事件、必要属性
```

所以 hydration 的重点不是“再创建一遍 DOM”，而是“接管和校验已有 DOM”。

### 3.1.3 `hydrateNode / hydrateElement / hydrateChildren` 这条链在做什么？

关键入口在 `packages/runtime-core/src/hydration.ts` 的 `createHydrationFunctions(...)`。

大致主链可以先记成：

```text
hydrate
  -> hydrateNode
  -> hydrateElement / hydrateFragment / hydrateChildren
```

这条链的职责是：

- 把已有 DOM 节点和当前 vnode 对齐
- 在对不上的时候做修正或 fallback
- 继续递归处理子节点

所以第九天一定要建立一个稳定认知：  
hydration 本质上是一种“带现成 DOM 的特殊 patch / 接管流程”。

### 3.1.4 lazy hydration strategy 为什么属于 Vue 3.5 值得单独看的能力？

因为这代表 Vue 不再把 hydration 只看成“页面一上来就全部接管”，而是允许异步组件按策略延迟 hydration。

你会在这些位置看到相关实现：

- `runtime-core/src/hydrationStrategies.ts`
- `runtime-core/src/apiAsyncComponent.ts`
- `runtime-core/src/index.ts`

当前仓库 `3.5.30` 里能看到：

- `hydrateOnIdle`
- `hydrateOnVisible`
- `hydrateOnMediaQuery`
- `hydrateOnInteraction`

这类能力。

所以第九天要把它理解成：  
Vue 3.5 在 hydration 上的一个很重要方向，是“让接管时机也可被策略化控制”。

### 3.1.5 `onWatcherCleanup`、`defineModel`、`useTemplateRef` 这些 3.5 能力分别落在哪些模块？

可以先压成一句话：

- `onWatcherCleanup`：主要落在 `reactivity` / `runtime-core` 的 watcher 体系
- `defineModel`：主要落在 `runtime-core` API 声明 + `compiler-sfc` 宏编译
- `useTemplateRef`：主要落在 `runtime-core` helper + template ref 运行时处理

再加上：

- watcher / effect 的 `pause()` / `resume()`：落在 `reactivity`
- lazy hydration strategies：落在 `runtime-core`

所以第九天真正要做的是“把 3.5 用户可见变化映射回 package 分层”，而不是只记 API 名字。

## 4. 推荐最小 demo

第九天建议分两个最小观察点。

### 4.1 SSR / hydration 观察点

先准备一个最简单组件树，重点不是复杂交互，而是观察：

- SSR 输出 HTML 长什么样
- 客户端 hydrate 时是否复用已有 DOM

### 4.2 3.5 特性观察点

建议重点挑这几类最小样例：

- `watchEffect` 里使用 `onWatcherCleanup`
- `defineModel`
- `useTemplateRef`
- `hydrateOnVisible` 或 `hydrateOnIdle`

第九天不必把所有特性都跑完，但要至少做到“能找到源码落点 + 能解释它属于哪一层”。

## 5. 推荐断点顺序

### 5.1 `packages/server-renderer/src/renderToString.ts`

重点看：

- `renderToString`

先确认：

```text
renderToString
  -> renderComponentVNode
```

### 5.2 `packages/server-renderer/src/render.ts`

重点看：

- `renderComponentVNode`
- `renderVNode`
- `renderVNodeChildren`

第九天在这里要看懂：

- SSR 仍然要经过组件 render / vnode 递归
- 但最终目标是 buffer / string，不是 DOM

### 5.3 `packages/runtime-core/src/hydration.ts`

这是第九天上午最核心的文件。

重点看：

- `createHydrationFunctions`
- `hydrate`
- `hydrateNode`
- `hydrateElement`
- `hydrateChildren`
- `hydrateFragment`

你要重点观察：

- 现成 DOM 是怎样被一层层接管的
- mismatch 时大概会怎样处理

### 5.4 `packages/runtime-core/src/apiAsyncComponent.ts`

重点看：

- `hydrate` 相关策略接入

这里最适合理解：

- lazy hydration 是怎样挂进 async component 的

### 5.5 `packages/runtime-core/src/hydrationStrategies.ts`

重点看：

- `hydrateOnIdle`
- `hydrateOnVisible`
- `hydrateOnMediaQuery`
- `hydrateOnInteraction`

这一步主要确认：

- 这些 3.5 能力为什么属于 runtime-core

### 5.6 第九天下午：3.5 主题落点巡检

建议按下面顺序扫一遍：

- `packages/reactivity/src/watch.ts`
  - `onWatcherCleanup`
- `packages/reactivity/src/effect.ts`
  - `pause` / `resume`
- `packages/runtime-core/src/apiSetupHelpers.ts`
  - `defineModel`
- `packages/compiler-sfc/src/script/defineModel.ts`
  - 宏编译落点
- `packages/runtime-core/src/helpers/useTemplateRef.ts`
  - `useTemplateRef`
- `packages/runtime-core/src/rendererTemplateRef.ts`
  - template ref 运行时接入

## 6. 第九天你应该重点观察到的事实

### 6.1 SSR 和 CSR 共用很多 vnode / 组件逻辑

但最终输出目标完全不同。

### 6.2 hydration 不是重新 mount，而是接管已有 DOM

这是第九天最核心的区分。

### 6.3 hydration 本身也是 renderer 体系的一部分

不是完全独立的另一套运行时。

### 6.4 Vue 3.5 的新增能力是分散落在不同 package 的

所以一定要按分层来理解，而不是把它们看成一串 API 名单。

### 6.5 当前仓库版本是 `3.5.30`

所以第九天整理专题时，应该优先相信当前仓库源码和测试，而不是旧文章。

## 7. 推荐记录方式

第九天建议至少沉淀这三份输出。

### 7.1 一张 SSR / hydration 对照表

| 主题 | 核心目标 | 关键入口 |
| --- | --- | --- |
| SSR | 输出 HTML | `renderToString` / `renderVNode` |
| CSR mount | 创建 DOM | `render` / `patch` |
| hydration | 接管已有 DOM | `hydrate` / `hydrateNode` |

### 7.2 一张 hydration 主链图

```text
hydrate
  -> hydrateNode
  -> hydrateElement / hydrateChildren / hydrateFragment
```

### 7.3 一张 Vue 3.5 主题落点表

| 主题 | 源码位置 | 属于哪层 |
| --- | --- | --- |
| `onWatcherCleanup` | `reactivity/src/watch.ts` | reactivity |
| `pause / resume` | `reactivity/src/effect.ts` | reactivity |
| `defineModel` | `runtime-core` + `compiler-sfc` | runtime + compiler |
| `useTemplateRef` | `runtime-core/src/helpers/useTemplateRef.ts` | runtime-core |
| lazy hydration | `runtime-core/src/hydrationStrategies.ts` | runtime-core |

## 8. 第九天完成标准

当你能回答下面这些问题，第九天就算过关了：

1. `renderToString` 这条链和客户端 mount 最大的差别是什么？
2. hydration 为什么不是重新创建整棵 DOM？
3. `hydrateNode / hydrateElement / hydrateChildren` 大概分别负责什么？
4. lazy hydration strategy 为什么算 Vue 3.5 的重点能力？
5. `onWatcherCleanup` 落在哪一层？
6. `defineModel` 为什么同时牵涉 runtime-core 和 compiler-sfc？
7. `useTemplateRef` 为什么属于 runtime-core helper？
8. 为什么整理 3.5 专题时要优先看当前仓库源码和测试？

## 9. 推荐的第九天阅读顺序

1. `packages/server-renderer/src/renderToString.ts`
2. `packages/server-renderer/src/render.ts`
3. `packages/runtime-core/src/hydration.ts`
4. `packages/runtime-core/src/apiAsyncComponent.ts`
5. `packages/runtime-core/src/hydrationStrategies.ts`
6. `packages/reactivity/src/watch.ts`
7. `packages/reactivity/src/effect.ts`
8. `packages/runtime-core/src/apiSetupHelpers.ts`
9. `packages/compiler-sfc/src/script/defineModel.ts`
10. `packages/runtime-core/src/helpers/useTemplateRef.ts`

## 10. 主线结束后怎么接

第九天结束后，这一轮主线就已经完整覆盖了：

- reactivity
- runtime-core
- runtime-dom
- compiler-core
- compiler-dom
- compiler-sfc
- server-renderer

如果还要继续深入，最自然的专题延伸是：

- `KeepAlive / Teleport`
- `Suspense / 异步组件 / lazy hydration`
- `watch / effectScope / cleanup` 深挖

## 11. 小结

第九天的核心不是把 SSR 和 3.5 新特性一口气全背下来，而是建立一个稳定认知：

- SSR 是“把组件树输出成 HTML”
- hydration 是“接管已有 DOM”
- Vue 3.5 的新能力分散落在 reactivity、runtime-core、compiler-sfc 等不同层

只要这一层想清楚了，你这轮 Vue 3.5 源码主线就已经闭环了。
