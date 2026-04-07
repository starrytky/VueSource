# Vue 源码阅读第一天打断点
更新时间：2026-03-25

## 1. 第一天的目标

第一天不要试图“看懂整个 Vue”，只完成一条最短主链路：

1. `createApp(App)`
2. `app.mount('#app')`
3. 创建根 vnode
4. 进入 renderer
5. 挂载组件实例
6. 执行 `setup`
7. 执行渲染函数
8. 把 vnode patch 成真实 DOM

如果这条链路能自己断点走通，第一天就算合格。

## 2. 第一天不要先看什么

先不要碰这些内容：

- 编译器 `compiler-core` / `compiler-dom`
- `Transition`
- `Teleport`
- `Suspense`
- `KeepAlive`
- SSR / hydration
- 复杂 diff 细节

原因很简单：这些分支很多，第一天会把你从主链路里带偏。

## 3. 推荐调试方式

先进入仓库目录：

```bash
cd VueSource/code/core-main
pnpm install
pnpm run dev
```

`pnpm run dev` 会默认构建 `vue` 的 `global` 开发包，并保持 watch。

建议再开一个终端启动静态服务：

```bash
pnpm run serve
```

然后在浏览器里打开一个你自己的最小 demo，或者访问仓库里的示例页面。

## 4. 推荐最小 demo

第一天建议不要用 `template`，直接用 `render`，这样可以先绕开编译器，专心看运行时。

可以临时准备这样一个最小示例：

```html
<div id="app"></div>
<script src="../../dist/vue.global.js"></script>
<script>
  const { createApp, h, ref } = Vue

  const App = {
    setup() {
      const count = ref(0)
      window.bump = () => count.value++
      return () =>
        h('button', { onClick: () => count.value++ }, `count: ${count.value}`)
    },
  }

  createApp(App).mount('#app')
</script>
```

这个 demo 有两个好处：

- 首次挂载链路很短
- 后面执行 `bump()` 或点击按钮，就能继续看更新链路

## 5. 第一天第一组断点

建议按下面顺序下断点。

### 5.1 `packages/runtime-dom/src/index.ts`

先看浏览器平台入口：

- `ensureRenderer`
- `createApp`
- 重写后的 `app.mount`

建议先从这里开始，因为这是最接近业务代码 `createApp(...).mount(...)` 的地方。

你会先看到 Vue 在 DOM 平台做了两件事：

- 通过 `createRenderer(rendererOptions)` 创建渲染器
- 对 `mount` 做 DOM 容器规范化和清空处理

### 5.2 关于 `runtime-dom` 里重写 `mount` 的补充问答

这里的“重写 `mount`”不是把真正的挂载逻辑推翻重写，而是在调用原始 `mount` 前后，补了一层 DOM 平台相关处理。大致流程是：

1. 保存原始 `mount`
2. 规范化挂载容器
3. 必要时从容器 `innerHTML` 中提取模板
4. 挂载前清空容器内容
5. 调用原始 `mount`
6. 挂载后移除 `v-cloak` 并打上 `data-v-app` 标记

也就是说，真正把组件渲染成 DOM 的核心工作，依然是原始 `mount` 完成的；`runtime-dom` 这里只是补 DOM 场景需要的适配层。

### 5.3 “对 `mount` 做 DOM 容器规范化和清空处理” 这一步在哪里？

这一步就在 `packages/runtime-dom/src/index.ts` 里重写后的 `app.mount` 中完成：

- `const container = normalizeContainer(containerOrSelector)`
- `if (container.nodeType === 1) { container.textContent = '' }`

其中：

- `normalizeContainer(...)` 负责把传入的选择器字符串、`Element`、`ShadowRoot` 统一成真正可挂载的容器
- `container.textContent = ''` 负责在挂载前清空普通元素容器里的旧内容

而真正执行挂载的是后面这句：

```ts
const proxy = mount(container, false, resolveRootNamespace(container))
```

可以把它理解成：先做 DOM 前置处理，再把处理好的容器交给运行时核心去挂载。

### 5.4 `__DEV__` 对应的是什么？

`__DEV__` 是一个“编译期注入的全局布尔常量”，表示当前是不是开发环境。它不是普通运行时变量，而是在构建时被直接替换掉的标记。

你可以简单把它理解成：

- `__DEV__ === true`：开发环境，保留告警、校验、调试辅助逻辑
- `__DEV__ === false`：生产环境，这些开发辅助分支会被裁掉

所以像下面这种代码：

```ts
if (__DEV__) {
  injectNativeTagCheck(app)
  injectCompilerOptionsCheck(app)
}
```

意思就是：这些逻辑只在开发环境执行，生产环境不会保留。

### 5.5 `container.nodeType === 1` 意味着什么？

这表示 `container` 是一个“元素节点”，也就是 DOM 里的 `Element`，例如 `div`、`span`、`svg`。

常见的 `nodeType` 可以先记这几个：

- `1`：元素节点 `Element`
- `3`：文本节点 `Text`
- `8`：注释节点 `Comment`
- `9`：文档节点 `Document`
- `11`：文档片段 `DocumentFragment`，`ShadowRoot` 也属于这一类

所以这段代码：

```ts
if (container.nodeType === 1) {
  container.textContent = ''
}
```

表达的就是：只有挂载目标是普通元素节点时，才清空它的内容；如果传入的是 `ShadowRoot`，它的 `nodeType` 是 `11`，这里就不会进入这个分支。

### 5.6 挂载后为什么要移除 `v-cloak` 并设置 `data-v-app`？

这段代码：

```ts
if (container instanceof Element) {
  container.removeAttribute('v-cloak')
  container.setAttribute('data-v-app', '')
}
```

是挂载完成后的收尾处理，只在容器是普通 DOM 元素时执行。

`removeAttribute('v-cloak')` 的作用是移除挂载前用于隐藏模板内容的 `v-cloak`。常见用法是：

```html
<div id="app" v-cloak>{{ msg }}</div>
```

```css
[v-cloak] { display: none; }
```

当 Vue 挂载完成后，就应该把它移除，让编译后的内容正常显示。

`setAttribute('data-v-app', '')` 的作用是给根容器打一个标记，表示“这个节点已经被一个 Vue 应用接管了”。这个标记主要方便调试、识别和框架层面的挂载痕迹管理。

外层要先判断 `container instanceof Element`，是因为 `removeAttribute` 和 `setAttribute` 这些 API 只适用于元素节点；如果容器是 `ShadowRoot`，就不能这样调用。

## 6. 第一天第二组断点

### 6.1 `packages/runtime-core/src/apiCreateApp.ts`

继续进入运行时核心入口，重点看：

- `createAppAPI`
- `app.mount`

这里要看清三件事：

1. `app` 对象是怎么创建出来的
2. 根组件是怎么变成根 vnode 的
3. `render(vnode, container)` 是怎么被调用的

第一天一定要记住这句：

```ts
const vnode = createVNode(rootComponent, rootProps)
render(vnode, rootContainer, namespace)
```

Vue 后面的大部分运行时工作，都是围绕这个 vnode 展开的。

## 7. 第一天第三组断点

### 7.1 `packages/runtime-core/src/vnode.ts`

这里重点看：

- `createVNode`
- `_createVNode`
- `normalizeVNode`

第一天不用把 vnode 所有字段都记住，只先关心这些：

- `type`
- `props`
- `children`
- `shapeFlag`
- `el`
- `component`

你需要先建立一个最基本认知：

Vue 在运行时不会直接“渲染组件对象”，而是先把它们统一变成 vnode，再交给 renderer。

## 8. 第一天第四组断点

### 8.1 `packages/runtime-core/src/renderer.ts`

这是第一天最核心的文件。

第一轮只盯住这几个函数：

- `createRenderer`
- `render`
- `patch`
- `processComponent`
- `mountComponent`
- `setupRenderEffect`
- `processElement`
- `mountElement`

建议理解成下面这条主链：

```text
render
  -> patch
    -> processComponent
      -> mountComponent
        -> setupComponent
        -> setupRenderEffect
          -> renderComponentRoot
          -> patch
            -> processElement
              -> mountElement
```

第一天最重要的，不是每个函数内部所有细节，而是要知道“组件 vnode”和“元素 vnode”分别在哪一步被分流处理。

可以顺手把这件事记准确一点：

- vnode 的“类别”不是到了 `patch` 才临时判断的，而是在 `createVNode -> _createVNode` 阶段就先编码进 `shapeFlag`
- 真正进入不同处理流程，是在 `renderer.ts` 的 `patch` 里根据 `shapeFlag` 分流

也就是说：

1. 如果 `type` 是字符串，比如 `'div'`，在 `_createVNode` 里会得到 `ShapeFlags.ELEMENT`
2. 如果 `type` 是组件对象或函数，在 `_createVNode` 里会得到 `ShapeFlags.STATEFUL_COMPONENT` 或 `ShapeFlags.FUNCTIONAL_COMPONENT`
3. 到了 `patch`，先处理 `Text`、`Comment`、`Fragment`、`Static` 这些特殊类型
4. 剩下的普通 vnode 再进入默认分支：
   - `shapeFlag & ShapeFlags.ELEMENT` -> `processElement`
   - `shapeFlag & ShapeFlags.COMPONENT` -> `processComponent`

所以可以用一句话概括：

`createVNode` 负责“给 vnode 贴标签”，`patch` 负责“按标签分流执行”。

再往下看时要特别注意一层递归：

- 组件 vnode 第一次进入 `patch` 时，会走 `processComponent -> mountComponent`
- 组件完成 `setup` 和 `render` 之后，会产出一个 `subTree`
- 这个 `subTree` 会再次进入 `patch`
- 这时候如果 `subTree` 是元素 vnode，才会走到 `processElement -> mountElement`

所以你在调试时看到的其实是两次不同语义的 `patch`：

- 第一次 `patch`：处理“组件 vnode 应该如何挂载”
- 第二次 `patch`：处理“组件 render 出来的子树 vnode 应该如何挂载”

## 9. 第一天第五组断点

### 9.1 `packages/runtime-core/src/component.ts`

这里主要看组件实例建立过程：

- `createComponentInstance`
- `setupComponent`
- `setupStatefulComponent`
- `handleSetupResult`
- `finishComponentSetup`

第一天只回答这些问题：

- 组件实例里大概存了什么
- `setup()` 在哪里被调用
- `setup()` 返回函数和返回对象分别怎么处理
- 渲染函数最后挂到了哪里

如果这部分看明白了，你就不会再把“组件对象”和“组件实例”混为一谈。

## 10. 首次挂载时你应该看到什么

当你一路断下来，应该能观察到这几个关键事实：

1. `createApp` 最终会生成根 vnode
2. `render` 会把根 vnode 交给 `patch`
3. `patch` 发现根 vnode 是组件，于是走 `processComponent`
4. `mountComponent` 里会创建组件实例
5. `setupComponent` 里会执行 `setup`
6. `setupRenderEffect` 里会执行组件渲染
7. 渲染结果会变成子树 vnode
8. 子树 vnode 再次进入 `patch`
9. 这一次如果是原生元素，就走 `processElement -> mountElement`
10. 最后真实 DOM 被插入容器

第一天只要把这 10 步串起来，进度就已经很扎实了。

## 11. 第二条补充链路：状态更新

首次挂载看完后，不要马上收工，再看一次“点击按钮后为什么会更新”。

建议在 demo 页面里执行：

```js
bump()
```

然后补下这组断点。

### 11.1 `packages/runtime-core/src/scheduler.ts`

重点看：

- `queueJob`
- `queueFlush`
- `flushJobs`
- `nextTick`

你要先建立一个直觉：

- Vue 更新不是每次状态变化都立刻同步整棵重渲染
- 它会把更新任务收进队列，再统一 flush

### 11.2 再回到 `packages/runtime-core/src/renderer.ts`

这次重点观察：

- 组件更新时什么时候进入 `instance.update`
- `patch` 第二次执行时，为什么会变成“新旧 vnode 对比”
- 元素节点更新时为什么会走 `patchElement`

第一天不要求你读完 keyed diff，只要知道“更新时还是 patch，只不过这次是 `n1` 和 `n2` 同时存在”就够了。

## 12. 如果你想顺手看运行时编译入口

如果你使用的是带编译器的完整构建，并且组件写了 `template`，可以额外在这里下一个断点：

- `packages/vue/src/index.ts`
- `compileToFunction`

但这是可选项，不建议第一天把主要精力放在这里。

第一天更推荐先用 `render()` 版本 demo，把运行时主链看通。

## 13. 建议记录方式

第一天最好边断边记，至少记这三张图：

- `createApp -> mount -> render -> patch` 调用图
- 组件实例结构草图
- 首次挂载和更新的分流图

如果你不想画图，至少整理一份这样的笔记：

```text
业务代码
  -> runtime-dom createApp / mount
  -> runtime-core createAppAPI
  -> createVNode
  -> renderer.render
  -> renderer.patch
  -> processComponent
  -> mountComponent
  -> setupComponent
  -> setupRenderEffect
  -> renderComponentRoot
  -> patch subtree
  -> processElement
  -> mountElement
```

## 14. 第一天完成标准

当你能回答下面这些问题，第一天就过关了：

1. `createApp(App).mount('#app')` 最终是谁调用了 `render`？
2. 根组件是在哪一步变成 vnode 的？
3. 组件实例是在哪一步创建的？
4. `setup()` 是在哪一步调用的？
5. 首次挂载时，组件 vnode 和元素 vnode 分别走哪个分支？
6. 状态变化后，为什么不是立刻同步重新渲染？
7. 第二次更新时，为什么还是走 `patch`？

## 15. 推荐的第一天阅读顺序

按这个顺序最稳：

1. `packages/runtime-dom/src/index.ts`
2. `packages/runtime-core/src/apiCreateApp.ts`
3. `packages/runtime-core/src/vnode.ts`
4. `packages/runtime-core/src/renderer.ts`
5. `packages/runtime-core/src/component.ts`
6. `packages/runtime-core/src/scheduler.ts`
7. 可选：`packages/vue/src/index.ts`

## 16. 小结

第一天的任务只有一句话：

从 `createApp(App).mount('#app')` 出发，把“组件如何变成真实 DOM”这条路径亲手断通一次。

先不要追求细节全懂，也不要急着研究所有高级特性。 
只要把挂载链路和一次更新链路走通，第二天再去看响应式、编译器、diff 细节，理解成本会明显下降。

## 17. 补充问答

这一节补充第一天打断点时最容易卡住的几个问题。

### 17.1 为什么 `ensureRenderer().createApp(...args)` 会跳到 `createAppAPI(...)` 里？

因为 `runtime-dom` 里的 `createApp` 只是平台层入口，真正的 `createApp` 是 `runtime-core` 里通过 `createAppAPI(render, hydrate)` 生成出来的。

关键链路是：

```ts
// packages/runtime-dom/src/index.ts
const app = ensureRenderer().createApp(...args)
```

```ts
// packages/runtime-core/src/renderer.ts
return {
  render,
  hydrate,
  createApp: createAppAPI(render, hydrate),
}
```

```ts
// packages/runtime-core/src/apiCreateApp.ts
export function createAppAPI(render, hydrate) {
  return function createApp(rootComponent, rootProps = null) {
    ...
  }
}
```

所以 `ensureRenderer().createApp(...args)` 本质上调用的是 `createAppAPI(render, hydrate)` 返回出来的那个内部 `createApp` 闭包。

### 17.2 `createAppAPI` 的两个入参分别是什么？

`createAppAPI` 的签名是：

```ts
createAppAPI(
  render: RootRenderFunction<HostElement>,
  hydrate?: RootHydrateFunction
)
```

- `render`
  普通渲染函数。负责把根组件对应的 vnode 挂到容器上，或在更新时继续走 patch。

- `hydrate`
  SSR 激活函数。服务端已经输出 HTML 时，客户端不是重新创建 DOM，而是把已有 DOM 和 vnode 对应起来。

在 `app.mount()` 里会根据场景选择调用谁：

```ts
if (isHydrate && hydrate) {
  hydrate(vnode, rootContainer)
} else {
  render(vnode, rootContainer, namespace)
}
```

可以先简单记成：

- `render` = 普通客户端挂载 / 更新
- `hydrate` = SSR 场景下的激活

### 17.3 `installAppCompatProperties(app, context, render)` 是干什么的？

这段逻辑只在 `__COMPAT__` 为真时才会执行。

```ts
if (__COMPAT__) {
  installAppCompatProperties(app, context, render)
}
```

它的作用不是 Vue 3 正常主流程必须要做的事，而是给“Vue 2 兼容构建”补一层兼容能力，让老项目迁移时还能跑。

它主要做几件事：

- 给 `app` 补 Vue 2 风格的兼容 API
  比如 `filter`、`set`、`delete`、`observable`、`extend`
- 模拟 Vue 2 风格的挂载方式
  比如先创建实例，再 `$mount()`
- 把全局单例 Vue 上的配置、组件、指令同步到当前 app
- 在开发环境下输出迁移警告

所以可以简单理解成：

- 普通模式 = 纯 Vue 3
- compat 模式 = Vue 3 + 一层 Vue 2 兼容适配器

### 17.4 什么是 compat 模式？

compat 模式就是 Vue 3 提供的“Vue 2 兼容运行模式”。

它的目标不是长期保留旧写法，而是帮助老项目从 Vue 2 逐步迁移到 Vue 3。也就是说：

- 先尽量让旧代码还能运行
- 再通过警告一点点改掉过时写法
- 最终回到纯 Vue 3

你在源码里看到这些内容，基本都属于 compat 层：

- `__COMPAT__`
- `convertLegacyComponent(...)`
- `convertLegacyVModelProps(...)`
- `defineLegacyVNodeProperties(...)`
- `installAppCompatProperties(...)`

新项目通常不需要依赖 compat 模式。

### 17.5 vnode 里这几个字段分别代表什么？

先只记最常用的 6 个：

- `type`
  这个 vnode 是什么。可能是原生标签名，也可能是组件对象，或者 `Text`、`Comment`、`Fragment` 这类内置类型。

- `props`
  传给这个 vnode 的参数。对元素来说是 `class`、`style`、事件等；对组件来说是组件 props。

- `children`
  这个 vnode 的子内容。可能是文本、子 vnode 数组，或者 slots 对象。

- `shapeFlag`
  一个“位标记”，表示 vnode 的类别和 children 的类别。运行时会靠它快速判断分支。

- `el`
  这个 vnode 最终对应的真实宿主节点。对 `runtime-dom` 来说通常就是真实 DOM 节点。

- `component`
  如果这个 vnode 是组件 vnode，这里会指向对应的组件实例 `ComponentInternalInstance`；元素 vnode 通常没有这个值。

可以这样记：

- `type`：我是谁
- `props`：我身上的参数
- `children`：我里面有什么
- `shapeFlag`：我属于哪一类
- `el`：我最后落到了哪个真实节点
- `component`：如果我是组件，我对应哪个组件实例

### 17.6 `shapeFlag` 是什么？

`shapeFlag` 是一个位运算标记，用来快速表达 vnode 的“形状”。

比如：

- 是不是元素
- 是不是组件
- children 是文本、数组，还是 slots

常见值在 `packages/shared/src/shapeFlags.ts` 里：

```ts
export enum ShapeFlags {
  ELEMENT = 1,
  FUNCTIONAL_COMPONENT = 1 << 1,
  STATEFUL_COMPONENT = 1 << 2,
  TEXT_CHILDREN = 1 << 3,
  ARRAY_CHILDREN = 1 << 4,
  SLOTS_CHILDREN = 1 << 5,
  ...
}
```

例如：

- `h('div', 'hi')` 大致会带上 `ELEMENT | TEXT_CHILDREN`
- `h('div', [child1, child2])` 大致会带上 `ELEMENT | ARRAY_CHILDREN`
- `h(App)` 大致会带上 `STATEFUL_COMPONENT`

### 17.7 `renderer.render` 这段入口代码在做什么？

核心逻辑可以概括成三件事：

1. 如果传入 `vnode == null`
   表示卸载当前容器中的旧树
2. 如果传入的是新 vnode
   就调用 `patch(oldVNode, newVNode, ...)`
   让 patch 统一处理首次挂载和后续更新
3. 把本次渲染后的根 vnode 缓存到 `container._vnode`
   下次再 render 时，它就会成为旧树

代码大意是：

```ts
const render = (vnode, container, namespace) => {
  if (vnode == null) {
    unmount(container._vnode, ...)
  } else {
    patch(container._vnode || null, vnode, container, ...)
  }
  container._vnode = vnode
  flushPreFlushCbs()
  flushPostFlushCbs()
}
```

可以把 `render` 理解成：

- 根入口
- 负责把“旧树 vs 新树”交给 `patch`
- 负责在一次渲染结束后统一 flush 调度队列

### 17.8 `mountComponent` 这段在干什么？

第一次进入组件 vnode 分支时，`patch -> processComponent -> mountComponent`，这个函数的任务就是把“组件 vnode”真正变成“组件实例 + 子树渲染”。

它大致做这些事：

1. 创建组件实例，并挂到 `initialVNode.component`
2. 如果是 `KeepAlive`，注入 renderer internals
3. 调用 `setupComponent(instance, false, optimized)`
   解析 props、slots，执行 `setup()`，为 render 做准备
4. 如果组件依赖异步 `setup()`，并且处在 `Suspense` 环境里
   就先注册依赖，必要时放一个注释节点占位
5. 否则直接执行 `setupRenderEffect(...)`
   正式进入组件的首次渲染

所以 `mountComponent` 不是直接创建 DOM，它是在准备“组件实例”和“组件子树”。

### 17.9 什么是 HMR？

HMR 是 `Hot Module Replacement`，中文一般叫“模块热替换”。

意思是：开发时你改了代码，不整页刷新，而是只替换改动过的模块。

在 Vue 开发里，它通常表现为：

- 修改组件文件
- 构建工具检测到变化
- 只替换这个组件模块
- 页面尽量不刷新
- 有时组件状态还能保留

源码里像这些逻辑都和 HMR 有关：

- `registerHMR(instance)`
- `isHmrUpdating`
- `context.reload`

例如：

```ts
if (__DEV__ && instance.type.__hmrId) {
  registerHMR(instance)
}
```

意思就是：开发环境下，如果这个组件支持热更新，就把它登记到 HMR 系统里。

### 17.10 什么是 Suspense 环境？

Suspense 环境指的是：当前组件处在 `<Suspense>` 组件管理之下。

源码里通常通过 `parentSuspense` 判断：

- 有值：说明当前组件在某个 `Suspense` 边界里面
- `null`：说明当前组件不在 Suspense 环境里

它主要用于处理异步组件或异步 `setup()`：

```ts
async setup() {
  const data = await fetchSomething()
  return { data }
}
```

如果组件有异步依赖，外层又有 `Suspense`，Vue 就不会立刻完成正式渲染，而是：

- 先把这个异步组件注册给 `parentSuspense`
- 必要时先渲染 fallback 或占位内容
- 等异步依赖完成后，再继续真正渲染

所以“Suspense 环境”本质上就是：

当前组件受某个 `<Suspense>` 边界统一协调。
