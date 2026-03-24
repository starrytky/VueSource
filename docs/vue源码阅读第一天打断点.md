# Vue 源码阅读第一天打断点
更新时间：2026-03-24

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
