# Vue 源码阅读第二天打断点
更新时间：2026-04-07

## 1. 第二天的目标

第二天不要扩散到整个响应式系统，也不要急着啃完整 diff。先只把这一条更新链路打通：

1. 修改响应式状态
   对应：`packages/reactivity/src/baseHandlers.ts` 的 `MutableReactiveHandler.set` / `deleteProperty`，继续进入 `packages/reactivity/src/dep.ts` 的 `trigger`
2. 组件 render effect 被触发
   对应：`packages/reactivity/src/dep.ts` 的 `Dep.trigger` / `notify`，再进入 `packages/reactivity/src/effect.ts` 的 `ReactiveEffect.trigger`
3. effect 不立刻重跑，而是交给 scheduler
   对应：`packages/reactivity/src/effect.ts` 的 `ReactiveEffect.trigger`
   关键绑定发生在：`packages/runtime-core/src/renderer.ts` 的 `setupRenderEffect`，这里把 `effect.scheduler` 设为 `() => queueJob(job)`
4. scheduler 把 job 放进队列并去重
   对应：`packages/runtime-core/src/scheduler.ts` 的 `queueJob`，需要时会调用 `findInsertionIndex`，并通过 `SchedulerJobFlags.QUEUED` 去重
5. flush 时按顺序执行 job
   对应：`packages/runtime-core/src/scheduler.ts` 的 `queueFlush` 与 `flushJobs`
6. 组件重新 `render`
   对应：`packages/runtime-core/src/renderer.ts` 的 `setupRenderEffect` 里 `componentUpdateFn`
   真正执行组件 `render` 的方法是：`packages/runtime-core/src/componentRenderUtils.ts` 的 `renderComponentRoot`
7. `patch(prevTree, nextTree)` 完成一次更新
   对应：`packages/runtime-core/src/renderer.ts` 的 `componentUpdateFn` 更新分支里的 `patch`
8. `watch` / 生命周期钩子在 pre / post 阶段插入执行
   `watch` 调度对应：`packages/runtime-core/src/apiWatch.ts` 的 `doWatch`
   `pre` 阶段执行对应：`packages/runtime-core/src/renderer.ts` 的 `updateComponentPreRender` -> `flushPreFlushCbs(instance)`
   `post` 阶段执行对应：`packages/runtime-core/src/renderer.ts` 的 `queuePostRenderEffect`，最终进入 `packages/runtime-core/src/scheduler.ts` 的 `queuePostFlushCb` / `flushPostFlushCbs`
   生命周期注册对应：`packages/runtime-core/src/apiLifecycle.ts` 的 `injectHook`；执行时机在 `packages/runtime-core/src/renderer.ts` 里通过 `invokeArrayFns` 或 `queuePostRenderEffect` 安排

如果你能回答“组件更新为什么会合并”和“`watch` 为什么有 `pre/post/sync` 三种时机”，第二天就算过关。

## 2. 第二天先不要看什么

先不碰这些内容：

- `reactivity` 里完整的依赖结构细节
- `compiler-core`
- `Transition` / `Teleport` / `Suspense`
- keyed diff 的完整实现
- SSR / hydration

第二天的重点不是“变化是怎么被追踪到的”，而是“变化来到运行时之后，Vue 怎么安排更新执行”。

## 3. 第二天的主问题

今天只围绕下面五个问题读源码：

1. 同一个 tick 内多次改状态，为什么通常只会触发一次组件更新？
2. 调度器怎样避免同一个组件重复入队？
3. 为什么组件更新顺序通常是父组件先、子组件后？
4. `watch` 的 `flush: 'pre' | 'post' | 'sync'` 到底分别插在哪里？
5. 组件更新时，什么时候只是更新 `props/slots`，什么时候会真正进入重新 `render + patch`？

## 3.1 这五个问题的直接答案

### 3.1.1 同一个 tick 内多次改状态，为什么通常只会触发一次组件更新？

因为多次状态变更最后都会落到同一个组件的同一个 `job` 上，而这个 `job` 在同一轮 flush 里只会入队一次。

调用链可以先记成这样：

```text
响应式 set
  -> trigger(...)
  -> 组件 render effect 被触发
  -> effect.scheduler()
  -> queueJob(instance.job)
```

组件更新相关的 scheduler 绑定发生在 `packages/runtime-core/src/renderer.ts` 的 `setupRenderEffect`：

```ts
const effect = (instance.effect = new ReactiveEffect(componentUpdateFn))
const update = (instance.update = effect.run.bind(effect))
const job: SchedulerJob = (instance.job = effect.runIfDirty.bind(effect))
job.id = instance.uid
effect.scheduler = () => queueJob(job)
```

关键点不在“有没有触发多次响应式”，而在“多次触发是不是都落到了同一个 `instance.job` 上”。

像下面这种代码：

```js
count.value++
count.value++
count.value++
```

通常确实会触发三次依赖通知，但这三次最终都会去调用同一个 `queueJob(instance.job)`，所以最后只会看到一次组件更新。

### 3.1.2 调度器怎样避免同一个组件重复入队？

答案就是 `SchedulerJobFlags.QUEUED`。

在 `packages/runtime-core/src/scheduler.ts` 的 `queueJob` 里，Vue 会先检查这个 job 是否已经带有 `QUEUED` 标记：

```ts
if (!(job.flags! & SchedulerJobFlags.QUEUED)) {
  ...
  job.flags! |= SchedulerJobFlags.QUEUED
  queueFlush()
}
```

这意味着：

- 第一次入队时，job 被放进队列，并打上 `QUEUED`
- 同一轮 flush 结束前，再次尝试 `queueJob(job)` 会被直接跳过
- 等 `flushJobs()` 真正执行完它，再把 `QUEUED` 清掉

所以“避免重复入队”不是靠比较组件实例，也不是靠比较 vnode，而是靠“同一个稳定的 job 引用 + QUEUED 标记”。

### 3.1.3 为什么组件更新顺序通常是父组件先、子组件后？

因为调度器会按 job 的 `id` 排序，而组件 job 的 `id` 就是组件实例的 `uid`。

在 `packages/runtime-core/src/renderer.ts` 的 `setupRenderEffect` 里：

```ts
const job: SchedulerJob = (instance.job = effect.runIfDirty.bind(effect))
job.id = instance.uid
```

在 `packages/runtime-core/src/scheduler.ts` 里，入队时会根据 `id` 决定插入位置：

```ts
queue.splice(findInsertionIndex(jobId), 0, job)
```

而父组件通常总是比子组件更早创建，所以：

- 父组件 `uid` 更小
- 子组件 `uid` 更大
- flush 时父组件 job 通常先执行，子组件 job 通常后执行

所以这个顺序本质上是“创建顺序 -> `uid` 顺序 -> scheduler 执行顺序”。

### 3.1.4 `watch` 的 `flush: 'pre' | 'post' | 'sync'` 到底分别插在哪里？

这一点主要看 `packages/runtime-core/src/apiWatch.ts` 的 `doWatch`。

#### `flush: 'sync'`

`sync` 不会走 scheduler 队列。依赖一触发，watch job 就立刻执行。

可以把它理解成：

```text
响应式变更
  -> 直接执行 watcher job
```

所以它的特点是：同步、立即、不合并。

#### `flush: 'pre'`

`pre` 是默认值。它的调度逻辑是：

- 首次运行直接同步执行，用来建立依赖
- 后续更新时走 `queueJob(job)`
- 并且会给 job 打上 `PRE` 标记

`apiWatch.ts` 里对应的是：

```ts
isPre = true
baseWatchOptions.scheduler = (job, isFirstRun) => {
  if (isFirstRun) {
    job()
  } else {
    queueJob(job)
  }
}
```

然后在 `augmentJob` 里补上：

```ts
job.flags! |= SchedulerJobFlags.PRE
job.id = instance.uid
job.i = instance
```

它的执行位置可以理解成“组件真正重新 render 之前”。

尤其是父组件给子组件传了新 `props` 时，Vue 会先在 `updateComponentPreRender()` 里同步 `props / slots`，然后立刻：

```ts
flushPreFlushCbs(instance)
```

也就是说，`pre` watcher 看到的是：

- 响应式值已经变了
- 但这次组件的 `render + patch` 还没执行
- 如果去碰 DOM，通常看到的还是更新前的 DOM

#### `flush: 'post'`

`post` 会被塞进 `queuePostRenderEffect(...)`，最终进入 `queuePostFlushCb(...)`。

这类回调不是在主队列里跑，而是在 `flushJobs()` 执行完主更新队列之后，由 `flushPostFlushCbs()` 统一执行。

所以 `post` watcher 看到的是：

- 当前这轮组件更新已经完成
- DOM 已经 patch 完
- 适合读取更新后的 DOM

#### 一句话记忆

- `sync`：依赖一变，立刻执行
- `pre`：组件本轮 `render` 之前执行
- `post`：组件本轮 `patch` 之后执行

### 3.1.5 组件更新时，什么时候只是更新 `props/slots`，什么时候会真正进入重新 `render + patch`？

这件事主要看 `packages/runtime-core/src/renderer.ts` 的 `updateComponent` 和 `componentUpdateFn`。

#### 情况一：根本不需要更新

如果 `shouldUpdateComponent(n1, n2, optimized)` 返回 `false`，那就不会进入组件更新流程。

Vue 只会做两件事：

```ts
n2.el = n1.el
instance.vnode = n2
```

也就是：

- 不重新 render
- 不 patch
- 只是把 vnode / el 对齐一下

#### 情况二：异步组件还没 resolve，只先同步 `props/slots`

在 `updateComponent()` 里，如果组件还是异步 pending 状态：

```ts
if (__FEATURE_SUSPENSE__ && instance.asyncDep && !instance.asyncResolved) {
  updateComponentPreRender(instance, n2, optimized)
  return
}
```

这里会走 `updateComponentPreRender()`，它会：

- `instance.vnode = nextVNode`
- `instance.next = null`
- `updateProps(...)`
- `updateSlots(...)`
- `flushPreFlushCbs(instance)`

然后直接返回，不进入后面的 `render + patch`。

所以这是“只更新 `props/slots`，但先不重渲染”的典型场景。

#### 情况三：正常组件更新，真正进入 `render + patch`

最常见的是这条路径：

```ts
instance.next = n2
instance.update()
```

然后进入 `setupRenderEffect()` 里的 `componentUpdateFn` 更新分支：

```text
如果 next 存在
  -> updateComponentPreRender(instance, next, optimized)
执行 beforeUpdate
  -> renderComponentRoot(instance)
  -> patch(prevTree, nextTree)
  -> queuePostRenderEffect(updated hooks)
```

这里才是完整的组件更新：

- 先同步 `props/slots`
- 再重新执行组件 `render`
- 最后拿 `prevTree` 和 `nextTree` 做 `patch`

#### 最后把三种情况压成一句话

- `shouldUpdateComponent` 为假：连重新 render 都不会进
- 异步组件还没 resolve：先只同步 `props/slots`
- 普通更新路径：同步 `props/slots` 后，继续 `render + patch`

## 4. 推荐最小 demo

第二天建议继续用最小 demo，但要加两类观察点：

- 同步连续修改状态，观察“合并更新”
- 加不同 `flush` 的 `watch`，观察执行顺序

可以临时准备这样的 demo：

```html
<div id="app"></div>
<script src="../../dist/vue.global.js"></script>
<script>
  const { createApp, h, ref, watch, nextTick } = Vue

  const Child = {
    props: ['n'],
    setup(props) {
      watch(
        () => props.n,
        () => console.log('child pre watch', props.n)
      )

      watch(
        () => props.n,
        () => console.log('child post watch', props.n),
        { flush: 'post' }
      )

      return () => h('p', `child: ${props.n}`)
    },
  }

  const App = {
    setup() {
      const count = ref(0)

      watch(count, () => console.log('parent pre watch', count.value))
      watch(
        count,
        () => console.log('parent post watch', count.value),
        { flush: 'post' }
      )
      watch(
        count,
        () => console.log('parent sync watch', count.value),
        { flush: 'sync' }
      )

      window.bump = () => {
        count.value++
        count.value++
        count.value++
      }

      window.bumpAndTick = async () => {
        count.value++
        console.log('after set')
        await nextTick()
        console.log('after nextTick')
      }

      return () =>
        h('div', [
          h(
            'button',
            {
              onClick() {
                count.value++
                count.value++
              },
            },
            `count: ${count.value}`
          ),
          h(Child, { n: count.value }),
        ])
    },
  }

  createApp(App).mount('#app')
</script>
```

这个 demo 主要看三件事：

- `bump()` 连续加三次，组件更新 job 是否只入队一次
- `sync` watcher 是否立刻执行
- `pre` watcher、组件更新、`post` watcher 的相对顺序

## 5. 推荐断点顺序

第二天建议按下面顺序下断点。

### 5.1 `packages/runtime-core/src/renderer.ts`

先回到你第一天已经看过的 `setupRenderEffect`，但这次不要只盯首次挂载，要重点看“更新 effect 是怎么建出来的”。

重点看：

- `setupRenderEffect`
- `const effect = new ReactiveEffect(componentUpdateFn)`
- `const update = instance.update = effect.run.bind(effect)`
- `const job = instance.job = effect.runIfDirty.bind(effect)`
- `effect.scheduler = () => queueJob(job)`

第二天先把这件事看明白：

组件不是“状态一变就直接重新 render”，而是：

```text
状态变化
  -> 触发组件 render effect
  -> effect.scheduler 被调用
  -> queueJob(instance.job)
  -> 微任务里 flushJobs()
  -> job 执行
  -> componentUpdateFn 重新 render + patch
```

这里最关键的一点是：

- `instance.update` 表示“主动执行一次 effect”
- `instance.job` 表示“交给 scheduler 管理的那个任务”

平时被调度器塞进队列去重的，不是裸 `effect.run`，而是稳定引用的 `instance.job`。

### 5.2 继续看 `renderer.ts` 的更新分支

重点看：

- `updateComponent`
- `updateComponentPreRender`
- `componentUpdateFn` 里的 `else` 分支

你要先区分两类更新来源：

1. 组件自己的响应式状态变了
   这时 `instance.next` 通常是 `null`
2. 父组件重新渲染，子组件收到了新的 vnode
   这时会先走 `updateComponent(n1, n2, optimized)`，把 `instance.next = n2`

然后在 `componentUpdateFn` 更新分支里统一处理。

建议重点看这段思路：

```text
如果 next 存在
  -> 先 updateComponentPreRender
  -> 同步 instance.vnode / props / slots
  -> flushPreFlushCbs(instance)
再 renderComponentRoot(instance)
再 patch(prevTree, nextTree)
最后 queuePostRenderEffect(...)
```

这里要特别记住一句：

`props` 更新可能先触发 pre watcher，所以 Vue 会在真正 render 前先 `flushPreFlushCbs(instance)`。

### 5.3 `packages/runtime-core/src/scheduler.ts`

这是第二天最核心的文件。

重点看：

- `queueJob`
- `queueFlush`
- `flushJobs`
- `flushPreFlushCbs`
- `flushPostFlushCbs`
- `nextTick`
- `SchedulerJobFlags`

建议按下面顺序理解。

#### 5.3.1 先看 `SchedulerJobFlags`

先记住这几个标记：

- `QUEUED`：这个 job 已经在队列里，别重复塞
- `PRE`：这是 pre 阶段 job，通常是 pre watcher
- `ALLOW_RECURSE`：允许递归触发，主要给组件更新函数和 watcher 回调
- `DISPOSED`：job 已失效，不再执行

第二天最重要的去重点，就落在 `QUEUED` 上。

#### 5.3.2 再看 `queueJob`

这段逻辑是回答“为什么多次修改状态通常只更新一次组件”的关键。

你要重点观察：

```ts
if (!(job.flags! & SchedulerJobFlags.QUEUED)) {
  ...
  job.flags! |= SchedulerJobFlags.QUEUED
  queueFlush()
}
```

也就是说，同一个 job 在本轮 flush 前只要已经打过 `QUEUED` 标记，就不会重复入队。

这也是为什么下面这种代码通常只触发一次组件更新：

```js
count.value++
count.value++
count.value++
```

不是因为没有触发三次，而是三次触发最后都落到同一个 `instance.job` 上，而这个 job 只会被排进队列一次。

#### 5.3.3 看 `queueFlush`

这段逻辑回答“为什么更新通常是异步批处理”：

```ts
if (!currentFlushPromise) {
  currentFlushPromise = resolvedPromise.then(flushJobs)
}
```

含义是：

- 当前轮还没安排 flush，就创建一个微任务
- 当前轮已经安排过 flush，后续只继续往队列里塞 job，不再重复创建微任务

所以可以先简单记成：

- `queueJob` 负责收任务
- `queueFlush` 负责安排“本轮统一结算”

#### 5.3.4 看 `flushJobs`

这里主要搞清两件事：

1. flush 真正开始时，按队列顺序跑 job
2. 跑完主队列后，再跑 post 队列

关键观察点：

- `for (flushIndex = 0; flushIndex < queue.length; flushIndex++)`
- `callWithErrorHandling(job, ...)`
- `flushPostFlushCbs(seen)`

你会看到 Vue 不只是“有一个队列”，而是至少分成：

- 主 job 队列
- post flush 队列

而 pre watcher 则会从主队列里提前抽出来执行。

#### 5.3.5 看 `findInsertionIndex` 和 `getId`

这部分是回答“为什么通常父先子后”的关键。

先记住：

- 组件 job 的 `id` 通常是 `instance.uid`
- 父组件总比子组件更早创建，所以 `uid` 更小
- 队列按 job id 递增插入

所以常见情况下，更新顺序天然就是：

```text
父组件更新 job
  -> 子组件更新 job
```

这不仅是为了稳定顺序，也有个实际收益：

如果父组件更新过程中把子组件卸载了，后面子组件本来排着的更新 job 就可以跳过。

#### 5.3.6 看 `nextTick`

第二天只要记清一句：

`nextTick()` 等的是“当前这轮已安排的 flush 完成”。

也就是：

- 你改完状态
- job 进队列
- `await nextTick()`
- 等到这轮 `flushJobs()` 以及 post flush 阶段都结束后再继续

## 6. `watch` 为什么会插进更新流程

接下来去 `packages/runtime-core/src/apiWatch.ts`。

重点看：

- `doWatch`
- `baseWatchOptions.scheduler`
- `baseWatchOptions.augmentJob`

第二天先不要被 `@vue/reactivity` 里的 `baseWatch` 细节带走，只看 runtime-core 给 watcher 加了什么调度语义。

### 6.1 `flush: 'sync'`

如果是：

```ts
watch(source, cb, { flush: 'sync' })
```

那它不会走额外调度器分支，基本就是触发时同步执行。

这类 watcher 适合：

- 你明确就是要立刻响应
- 你接受它打断当前同步流程

但它不适合滥用，因为它不会享受批处理优势。

### 6.2 `flush: 'pre'`

默认就是 `pre`。

关键逻辑是：

```ts
baseWatchOptions.scheduler = (job, isFirstRun) => {
  if (isFirstRun) {
    job()
  } else {
    queueJob(job)
  }
}
```

以及：

```ts
job.flags! |= SchedulerJobFlags.PRE
job.id = instance.uid
job.i = instance
```

这里要看懂三件事：

1. pre watcher 后续会进入主队列
2. 它会被打上 `PRE` 标记
3. 它会拿到和当前组件更新 job 一样的 `id`

这就是为什么它能被插到“组件更新前面”，并且和组件更新一起保持稳定顺序。

### 6.3 `flush: 'post'`

关键逻辑是：

```ts
baseWatchOptions.scheduler = job => {
  queuePostRenderEffect(job, instance && instance.suspense)
}
```

也就是 post watcher 不进主队列，而是走 post render effect 队列。

所以它更适合：

- 依赖更新后的 DOM
- 想在组件 patch 完成后再执行副作用

你可以把三种 flush 先粗略记成：

- `sync`：现在就跑
- `pre`：组件 render 前跑
- `post`：组件 patch 后跑

## 7. 第二天你应该重点观察到的事实

当你断点跑完后，应该能确认下面这些事实。

### 7.1 组件更新会合并，是因为“同一个 job 被复用”

不是每次状态变化都新建一个任务，而是复用当前组件固定的 `instance.job`。

所以多次触发最后都落到同一个 job 身上，而 `queueJob` 会用 `QUEUED` 标记挡掉重复入队。

### 7.2 组件更新默认不是同步执行，而是微任务批处理

`queueFlush()` 里用 `Promise.resolve().then(flushJobs)` 安排本轮 flush。

因此“本次同步代码里的多次状态修改”通常会先积攒下来，再统一刷新。

### 7.3 父子组件顺序不是随机的

job 有 id，队列按 id 插入；组件 id 又通常按创建顺序递增，所以父组件往往先于子组件更新。

### 7.4 pre watcher 不只是“更早执行”，而是“插在组件更新前面”

它不是独立于组件更新流程之外的一套机制，而是直接参与 scheduler 排队规则。

### 7.5 post watcher 和 mounted / updated 一样，更接近“patch 完再执行”

它们都更适合做依赖 DOM 最终状态的副作用。

## 8. 推荐记录方式

第二天建议至少沉淀这三份输出。

### 8.1 一张更新调度总图

建议你画成这样：

```text
trigger
  -> effect.scheduler
  -> queueJob(instance.job)
  -> queueFlush()
  -> flushPreFlushCbs()
  -> job()
  -> renderComponentRoot()
  -> patch(prevTree, nextTree)
  -> flushPostFlushCbs()
```

### 8.2 一张 flush 时机对照表

建议至少记这一版：

| 类型 | 进入方式 | 执行时机 | 典型用途 |
| --- | --- | --- | --- |
| component update | `queueJob(instance.job)` | 主队列 | 组件重渲染 |
| watch sync | 同步执行 | 立刻 | 需要立即响应的副作用 |
| watch pre | `queueJob(job)` + `PRE` | render 前 | 依赖最新状态但不依赖新 DOM |
| watch post | `queuePostRenderEffect(job)` | patch 后 | 依赖更新后 DOM |
| `nextTick` 回调 | `currentFlushPromise.then(...)` | 本轮 flush 结束后 | 等待本轮更新完成 |

### 8.3 一份“组件更新来源”对照表

| 来源 | 入口 | 关键状态 |
| --- | --- | --- |
| 自身状态变化 | `effect.scheduler -> queueJob(job)` | `instance.next === null` |
| 父组件传来新 vnode | `updateComponent(n1, n2, optimized)` | `instance.next = n2` |

## 9. 第二天完成标准

当你能回答下面这些问题，第二天就算过关了：

1. `instance.update` 和 `instance.job` 分别是什么关系？
2. 为什么同一个 tick 里多次 `count.value++` 通常只更新一次？
3. `queueJob` 是靠什么机制避免重复入队的？
4. 为什么组件更新通常不是立刻同步执行？
5. `watch(..., { flush: 'pre' })` 和 `watch(..., { flush: 'post' })` 分别插在什么位置？
6. 为什么 pre watcher 会和组件更新拥有相同的 `id`？
7. `nextTick()` 等到的到底是哪一个阶段结束？
8. 组件更新时，`props/slots` 在什么时候先被同步到实例上？

## 10. 推荐的第二天阅读顺序

按这个顺序最稳：

1. `packages/runtime-core/src/renderer.ts`
   先看 `setupRenderEffect` 里 job 是怎么建出来的
2. `packages/runtime-core/src/scheduler.ts`
   再看 job 怎样入队、排序、flush
3. `packages/runtime-core/src/apiWatch.ts`
   最后看 watcher 怎样挂接到 scheduler
4. 回到 `renderer.ts`
   对照 `updateComponent`、`updateComponentPreRender`、更新分支再走一遍

## 11. 第三天怎么接

第二天结束后，第三天有两条自然延伸路线：

- 路线 A：进入 `reactivity`
  解决“到底是谁触发了 effect.scheduler”
- 路线 B：继续留在 `renderer`
  深挖 `patchElement`、`patchChildren`、keyed diff

如果你现在最卡的是“新为什么会合并、调度器怎样安排执行”，建议先把第二天吃透，再去补 `reactivity`，理解会更稳。

## 12. 小结

第二天的核心不是把所有更新细节都背下来，而是建立一个稳定认知：

- 组件更新是 effect 驱动的
- effect [伊-费克特] 默认不直接重跑，而是交给 scheduler [斯凯-久-勒]
- scheduler 通过稳定 job、去重标记、微任务 flush，把多次变化合并成一轮更新
- watcher 不是额外平行系统，而是以不同 flush 时机插入这轮更新

只要这一层想清楚了，后面再看 `trigger`、`track`、`patchElement`、children diff，就不会觉得它们是分散知识点，而会自然接到同一条更新链路上。
