# Vue 源码阅读第三天打断点
更新时间：2026-04-20

## 1. 第三天的目标

第三天不要急着跳进 `patchElement`、`patchChildren`、keyed diff，也不要把注意力分散到编译器。  
今天只做一件事：把“到底是谁触发了 `effect.scheduler`”这件事从 `reactivity` 里彻底走通。

第三天只围绕下面这条链路读源码：

1. `reactive()` / `ref()` / `computed()` 分别创建了什么响应式载体
2. 组件 render effect 在运行时，为什么普通 `get` 能把当前 effect 记下来
3. 依赖关系最终存到了哪里
4. 状态修改后，为什么不是直接 `render`，而是继续回到第二天的 scheduler
5. `computed` 为什么是脏标记 + 惰性求值，而不是依赖一变就立刻重算
6. 条件分支切换后，旧依赖为什么能自动失效

如果你能回答“`state.count` 是怎么记住当前组件的”和“为什么 `computed` 默认不会立刻重算”，第三天就算过关。

## 2. 第三天先不要看什么

先不碰这些内容：

- `renderer.ts` 里的 `patchElement` / `patchChildren` / `patchKeyedChildren`
- `runtime-dom` 的 `patchProp`、事件和样式模块
- `compiler-core`
- `Transition` / `Teleport` / `Suspense`
- SSR / hydration
- collection 的所有边角分支

第三天的重点不是“VNode 怎么比较”，而是“响应式系统怎样把一次普通读写变成可调度的更新”。

## 3. 第三天的主问题

今天只围绕下面五个问题读源码：

1. 组件 `render` 里读到 `state.count` 时，Vue 到底把“谁依赖了它”记到了哪里？
2. `targetMap`、`Dep`、`Link`、`activeSub` 各自扮演什么角色？
3. `reactive` 和 `ref` 为什么都能触发组件更新，但内部路径又不完全一样？
4. `computed` 为什么默认是惰性的，依赖变了为什么通常不是立刻重新计算？
5. 条件分支切换后，为什么旧分支上的依赖会被清掉？

## 3.1 这五个问题的直接答案

### 3.1.1 组件 `render` 里读到 `state.count` 时，Vue 到底把“谁依赖了它”记到了哪里？

答案是：先把“当前正在运行的订阅者”放到 `activeSub`，然后在 `get` 时通过 `track(...)` 把 `target.key -> activeSub` 这条关系记下来。

第二天你已经看过组件 render effect 的创建位置，在 `packages/runtime-core/src/renderer.ts` 的 `setupRenderEffect`：

```ts
const effect = (instance.effect = new ReactiveEffect(componentUpdateFn))
const update = (instance.update = effect.run.bind(effect))
const job: SchedulerJob = (instance.job = effect.runIfDirty.bind(effect))
effect.scheduler = () => queueJob(job)
```

真正让“当前 effect”生效的，不是构造函数，而是 `packages/reactivity/src/effect.ts` 的 `ReactiveEffect.run()`：

```ts
const prevEffect = activeSub
const prevShouldTrack = shouldTrack
activeSub = this
shouldTrack = true

try {
  return this.fn()
} finally {
  activeSub = prevEffect
  shouldTrack = prevShouldTrack
}
```

也就是说：

- 组件开始执行 `render` 前，当前组件的 render effect 会被放进 `activeSub`
- 这次 `render` 里所有触发到的响应式 `get`
- 都有机会把自己和这个 effect 建立依赖关系

所以“谁依赖了 `state.count`”不是在组件实例里靠名字记录的，而是在 effect 运行期间，借助 `activeSub` 动态收集出来的。

### 3.1.2 `targetMap`、`Dep`、`Link`、`activeSub` 各自扮演什么角色？

可以先把它们压成一句话：

```text
activeSub 表示“当前是谁在读”
targetMap 表示“这个对象的每个 key 对应哪个 dep”
Dep 表示“这个 key 的订阅中心”
Link 表示“某个 dep 和某个 effect 之间的一条双向连接”
```

`packages/reactivity/src/dep.ts` 里最核心的入口是 `track(target, type, key)`：

```ts
let depsMap = targetMap.get(target)
if (!depsMap) {
  targetMap.set(target, (depsMap = new Map()))
}
let dep = depsMap.get(key)
if (!dep) {
  depsMap.set(key, (dep = new Dep()))
}
dep.track()
```

这里的层次是：

- `targetMap`：`WeakMap<object, Map<key, Dep>>`
- `depsMap`：某个 target 对应的 key -> dep 映射
- `Dep`：某一个具体 key 的订阅中心

再往里走，`Dep.track()` 不只是把 effect 丢进一个 `Set`，而是会创建一个 `Link(activeSub, dep)`。

这个 `Link` 很重要，因为它同时挂在两条链表上：

- 一条挂在 effect 身上，表示“当前 effect 依赖了哪些 dep”
- 一条挂在 dep 身上，表示“当前 dep 被哪些 subscriber 订阅了”

所以第三天一定要纠正一个直觉：

Vue 现在的依赖结构不只是“`target -> key -> Set<effect>`”这么简单，而是通过 `Dep + Link` 建立了更适合清理和复用的双向结构。

### 3.1.3 `reactive` 和 `ref` 为什么都能触发组件更新，但内部路径又不完全一样？

因为它们最终都会走到 “dep 通知 subscriber” 这件事上，但依赖存储的位置不同。

#### `reactive`

`reactive()` 在 `packages/reactivity/src/reactive.ts` 里最终会创建一个 `Proxy`：

```ts
const proxy = new Proxy(
  target,
  targetType === TargetType.COLLECTION ? collectionHandlers : baseHandlers,
)
```

普通对象读取时，会进入 `packages/reactivity/src/baseHandlers.ts` 的 `get`：

```ts
track(target, TrackOpTypes.GET, key)
```

普通对象修改时，会进入 `MutableReactiveHandler.set` / `deleteProperty`，最终调用：

```ts
trigger(target, TriggerOpTypes.SET, key, value, oldValue)
trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
```

也就是说，`reactive` 的依赖入口是：

```text
Proxy get -> track(target, key)
Proxy set/delete -> trigger(target, key)
```

#### `ref`

`ref()` 在 `packages/reactivity/src/ref.ts` 里不是走 `targetMap` 那套，而是每个 `RefImpl` 自己带一个 `dep`：

```ts
class RefImpl<T = any> {
  dep: Dep = new Dep()
}
```

读取 `.value` 时：

```ts
this.dep.track()
```

设置 `.value` 时：

```ts
this.dep.trigger()
```

所以 `ref` 的依赖入口是：

```text
ref.value get -> ref.dep.track()
ref.value set -> ref.dep.trigger()
```

#### 一句话对比

- `reactive`：依赖挂在 `targetMap -> key -> dep`
- `ref`：依赖直接挂在 ref 实例自己的 `dep`

但不管入口是哪种，最后都会通知到订阅它的 effect，于是又回到第二天的组件更新链路。

### 3.1.4 `computed` 为什么默认是惰性的，依赖变了为什么通常不是立刻重新计算？

因为 `computed` 的核心不是“依赖一变就马上求值”，而是“先标脏，等下次有人读取 `.value` 时再决定要不要重算”。

`packages/reactivity/src/computed.ts` 里的 `ComputedRefImpl` 同时具备两种身份：

- 它自己有一个 `dep`，因为别人会依赖 `computed.value`
- 它自己也是一个 `Subscriber`，因为它内部又会依赖别的响应式值

依赖变化时，`ComputedRefImpl.notify()` 只做两件关键事：

```ts
this.flags |= EffectFlags.DIRTY
batch(this, true)
return true
```

这表示：

- 先把 computed 标记成 `DIRTY`
- 告诉外层：这是一个 computed，需要继续通知“依赖这个 computed 的人”

真正读取值时，才会在 `get value()` 里调用：

```ts
refreshComputed(this)
```

而 `packages/reactivity/src/effect.ts` 的 `refreshComputed()` 会做两层判断：

1. 如果这次全局版本没变，直接走缓存
2. 如果依赖没脏，直接复用旧值
3. 只有真的脏了，才重新执行 `computed.fn(...)`

所以 `computed` 的核心不是“立即算”，而是：

```text
依赖变化
  -> computed 标脏
  -> 下次有人读 computed.value
  -> refreshComputed()
  -> 需要时才重新求值
```

这就是它默认惰性的根本原因。

### 3.1.5 条件分支切换后，为什么旧分支上的依赖会被清掉？

因为 effect 每次重新运行前，Vue 会先把旧依赖全部标成“待确认”，本轮真正访问到的再重新激活，没再访问到的依赖最后会被清理掉。

这个机制主要在 `packages/reactivity/src/effect.ts` 里完成：

1. `prepareDeps(this)`
   把旧 link 的 `version` 先置成 `-1`
2. 重新运行 effect
   本轮读到的 dep 会在 `Dep.track()` 里把 link.version 同步回来
3. `cleanupDeps(this)`
   把仍然是 `-1` 的 link 从 effect 和 dep 两边一起移除

所以像下面这种代码：

```js
watchEffect(() => {
  console.log(state.ok ? state.text : state.count)
})
```

当 `state.ok` 从 `true` 变成 `false` 以后：

- 下一次 effect 重跑时，会访问 `state.count`
- 不再访问 `state.text`
- `state.text` 那条旧 link 最终会被 `cleanupDeps()` 清掉

所以后面再改 `state.text`，这个 effect 就不会重新触发了。

这不是“Vue 记住了条件分支语义”，而是每轮 effect 都按“本轮真实访问到的依赖”重建一次依赖图。

## 4. 推荐最小 demo

第三天建议用一个能同时观察 `reactive`、`ref`、`computed`、分支清理的 demo：

```html
<div id="app"></div>
<script src="../../dist/vue.global.js"></script>
<script>
  const { createApp, h, reactive, ref, computed, watchEffect } = Vue

  const App = {
    setup() {
      const state = reactive({
        ok: true,
        text: 'hello',
        count: 0,
      })

      const extra = ref(10)

      const total = computed(() => {
        console.log('computed run')
        return state.count + extra.value
      })

      watchEffect(() => {
        console.log(
          'branch effect ->',
          state.ok ? state.text : total.value
        )
      })

      window.flip = () => {
        state.ok = !state.ok
      }

      window.bump = () => {
        state.count++
      }

      window.rename = () => {
        state.text += '!'
      }

      window.bumpRef = () => {
        extra.value++
      }

      return () =>
        h('div', [
          h('button', { onClick: () => (state.ok = !state.ok) }, `ok: ${state.ok}`),
          h('button', { onClick: () => state.count++ }, `count: ${state.count}`),
          h('button', { onClick: () => extra.value++ }, `extra: ${extra.value}`),
          h('p', state.ok ? state.text : String(total.value)),
        ])
    },
  }

  createApp(App).mount('#app')
</script>
```

这个 demo 主要看四件事：

- 为什么读 `state.text` 会经过 `Proxy.get -> track`
- 为什么读 `extra.value` 会走 `ref.dep.track()`
- 为什么 `computed` 不是每次依赖一变就立刻打印 `computed run`
- `flip()` 之后，为什么 `rename()` 不再触发原来的分支 effect

## 5. 推荐断点顺序

第三天建议按下面顺序下断点。

### 5.1 先回到 `packages/runtime-core/src/renderer.ts`

先重新看一眼 `setupRenderEffect`，只确认一件事：

- 当前组件更新最终依赖的是哪个 `ReactiveEffect`
- 这个 effect 的 `scheduler` 确实已经绑到了 `queueJob(job)`

第三天不用在这里停太久，只要把“后面为什么会回到 scheduler”这件事重新接上。

### 5.2 `packages/reactivity/src/effect.ts`

这一天最关键的断点是：

- `ReactiveEffect.run`
- `ReactiveEffect.notify`
- `ReactiveEffect.trigger`
- `runIfDirty`
- `startBatch`
- `endBatch`
- `refreshComputed`

先重点看 `run()`，确认：

```text
effect.run()
  -> activeSub = 当前 effect
  -> shouldTrack = true
  -> 执行 render / getter
  -> 恢复上一个 activeSub
```

第三天要真正建立的认知是：

不是“某个响应式值主动知道当前组件是谁”，而是“当前 effect 正在运行，所以响应式读取时顺手把它记下来”。

然后再看 `notify -> batch -> endBatch -> trigger` 这条线，确认：

- `dep.notify()` 并不会立刻直接调用 `render`
- 它会先把 subscriber 放进批处理链
- 批处理结束后，才调用 `ReactiveEffect.trigger()`
- 如果这个 effect 带 `scheduler`，就进入第二天的 `queueJob(job)`

### 5.3 `packages/reactivity/src/baseHandlers.ts`

重点看：

- `BaseReactiveHandler.get`
- `MutableReactiveHandler.set`
- `MutableReactiveHandler.deleteProperty`
- `has`
- `ownKeys`

这一天至少把下面三种读取区分开：

1. 普通属性读取
   走 `get -> track(target, GET, key)`
2. `key in obj`
   走 `has -> track(target, HAS, key)`
3. 遍历类读取
   走 `ownKeys -> track(target, ITERATE, ...)`

这很重要，因为第三天你会看到：

- 不是只有 `obj.foo` 才会建立依赖
- “存在性”和“遍历结构”本身也可以成为依赖

再看 `set` 时，要重点观察这几件事：

- 怎样区分 `ADD` 和 `SET`
- 新旧值没变时为什么不会触发
- 为什么数组索引和普通对象 key 要分开判断

### 5.4 `packages/reactivity/src/dep.ts`

这是第三天最核心的文件。

重点看：

- `Dep`
- `Link`
- `track`
- `Dep.track`
- `trigger`
- `Dep.trigger`
- `Dep.notify`

建议按下面顺序理解。

#### 5.4.1 先看 `track`

先记住：

```text
targetMap
  -> depsMap
    -> dep
      -> link
        -> activeSub
```

不要把 `track()` 理解成“简单地把 effect 扔进一个集合”，这会让后面很多清理逻辑看不懂。

#### 5.4.2 再看 `Dep.track`

这里的关键不是“创建 link”，而是“如果是旧 link 复用，怎样把它移到 effect 依赖链表尾部，并同步版本号”。

第三天你要重点观察两个细节：

- 新依赖如何挂到 effect 的 `deps/depsTail`
- 老依赖复用时，为什么还要调整链表顺序

这和后面的依赖清理、computed 脏检查都直接相关。

#### 5.4.3 再看 `trigger`

这里要先区分两层：

1. `trigger(target, type, key, ...)`
   负责从 `targetMap` 里找到受影响的 dep
2. `dep.trigger() / dep.notify()`
   负责把这些 dep 对应的 subscriber 统一通知出去

你要重点观察：

- 为什么数组 `length` 有特殊处理
- 为什么 `ADD` / `DELETE` 会额外影响遍历依赖
- 为什么 `CLEAR` 会一次性触发整张 `depsMap`

第三天不要求把每个集合分支背下来，但一定要看懂：  
“一次写操作，不一定只影响一个 key 的 dep，它可能还会波及结构依赖。”

### 5.5 `packages/reactivity/src/ref.ts`

重点看：

- `ref`
- `createRef`
- `RefImpl`
- `get value`
- `set value`
- `triggerRef`

第三天要明确一点：

`ref` 不是 Proxy，它就是一个普通对象实例，只是自己带了一个 `dep`。

所以这里和 `reactive` 的最大区别是：

- `reactive` 的依赖存储是“外部 targetMap”
- `ref` 的依赖存储是“实例内 dep”

### 5.6 `packages/reactivity/src/computed.ts`

重点看：

- `ComputedRefImpl`
- `notify`
- `get value`
- `computed(...)`

这里你要重点确认两件事：

1. `computed` 自己也是 subscriber
2. `computed.value` 的读取才是真正触发 `refreshComputed()` 的入口

第三天把下面这句吃透就够了：

```text
computed 默认不是 eager，而是 dirty + lazy refresh
```

### 5.7 可选：`packages/reactivity/src/watch.ts`

如果你第三天还有余力，可以补看：

- `watch`
- `ReactiveEffect(getter)`
- `effect.scheduler = ...`

这个文件能帮你确认一件事：

`watch` 的本体其实已经在 `@vue/reactivity` 里了；第二天你在 `runtime-core/src/apiWatch.ts` 里看到的更多是“给 watcher 补组件级调度语义”。

## 6. 第三天你应该重点观察到的事实

当你断点跑完后，应该能确认下面这些事实。

### 6.1 依赖收集发生在“读”的时候，不发生在“写”的时候

写操作只是触发通知；真正建立关系的是读取时的 `track(...)`。

### 6.2 响应式系统并不知道“组件”这个概念，它只知道 subscriber

对 `reactivity` 来说：

- 组件 render effect 是 subscriber
- watcher 是 subscriber
- computed 也是 subscriber

“组件更新”是 runtime-core 在上层赋予某个 effect 的语义。

### 6.3 `reactive` 和 `ref` 的依赖存储结构不同

- `reactive`：`targetMap -> key -> dep`
- `ref`：`ref.dep`

但它们最后都会通过 `Dep.notify()` 走到同一套 subscriber 触发逻辑。

### 6.4 `computed` 的核心是缓存失效，不是即时重算

依赖变化时先标记 `DIRTY`；真正读取时再决定是否重算。

### 6.5 依赖关系不是“只增不减”，而是每轮 effect 都会重新校准

这就是为什么分支切换后，旧依赖能自动失效。

### 6.6 第二天的 scheduler 其实是 reactivity 的下游

第三天应该能把这条链路彻底接起来：

```text
响应式写操作
  -> trigger(...)
  -> dep.notify()
  -> batch(...)
  -> ReactiveEffect.trigger()
  -> effect.scheduler()
  -> queueJob(instance.job)
  -> scheduler flush
```

也就是说：

- 第三天解决的是“谁调用了 `effect.scheduler`”
- 第二天解决的是“`effect.scheduler` 之后发生了什么”

两天合在一起，才是一条完整更新链路。

## 7. 推荐记录方式

第三天建议至少沉淀这三份输出。

### 7.1 一张依赖收集总图

建议至少画成这样：

```text
effect.run()
  -> activeSub = 当前 effect
  -> Proxy.get / ref.value get
  -> track(...)
  -> targetMap / dep / link 建立连接
```

### 7.2 一张触发更新总图

建议至少记这一版：

```text
Proxy.set / ref.value set
  -> trigger(...)
  -> dep.notify()
  -> batch(...)
  -> ReactiveEffect.trigger()
  -> scheduler ? scheduler() : runIfDirty()
```

### 7.3 一张 `reactive / ref / computed` 对照表

建议至少对比下面这些维度：

| 类型 | 读取时怎么 track | 写入时怎么 trigger | 依赖存哪 | 特点 |
| --- | --- | --- | --- | --- |
| `reactive` | `Proxy.get -> track(target, key)` | `set/delete -> trigger(target, key)` | `targetMap` | 面向对象属性 |
| `ref` | `ref.dep.track()` | `ref.dep.trigger()` | 实例内 `dep` | 面向单值容器 |
| `computed` | `computed.dep.track()` + `refreshComputed()` | 依赖变更时 `notify()` 标脏 | 自己有 `dep`，自己也是 subscriber | 惰性、缓存、脏检查 |

## 8. 第三天完成标准

当你能回答下面这些问题，第三天就算过关了：

1. `ReactiveEffect.run()` 为什么能让后续读取知道“当前是谁在读”？
2. `targetMap` 里的层次结构到底是什么？
3. `Dep` 和 `Link` 为什么要拆成两层，而不是直接 `Set<effect>`？
4. `reactive` 的 `get/set` 和 `ref` 的 `.value` 读写路径分别是什么？
5. `dep.notify()` 到 `effect.scheduler()` 中间还经过了哪些步骤？
6. 为什么 `computed` 默认不是依赖一变就立刻重新求值？
7. 为什么条件分支切换后，旧依赖可以自动清掉？
8. 为什么说第二天的 scheduler 是第三天这套触发机制的下游？

## 9. 推荐的第三天阅读顺序

按这个顺序最稳：

1. `packages/runtime-core/src/renderer.ts`
   回看 `setupRenderEffect`，确认组件 render effect 是怎么创建的
2. `packages/reactivity/src/effect.ts`
   先看 `run / notify / trigger / refreshComputed`
3. `packages/reactivity/src/baseHandlers.ts`
   再看 `get / set / deleteProperty / has / ownKeys`
4. `packages/reactivity/src/dep.ts`
   把 `targetMap / Dep / Link / track / trigger` 串起来
5. `packages/reactivity/src/ref.ts`
   补上 `ref` 的独立 `dep` 路径
6. `packages/reactivity/src/computed.ts`
   最后看 `computed` 的脏标记和惰性求值
7. 可选：`packages/reactivity/src/watch.ts`
   补 watcher 如何复用 `ReactiveEffect`

## 10. 第四天怎么接

第三天结束后，第四天有两条自然延伸路线：

- 路线 A：回到 `renderer.ts`
  深挖 `patchElement`、`patchChildren`、`patchKeyedChildren`
- 路线 B：继续停留在 `reactivity`
  深挖 `watch`、`effectScope`、cleanup、pause / resume、collection handlers

如果你现在最卡的是“新旧 vnode 到底怎样比较”，下一天就该回到 renderer。  
如果你现在最卡的是“watch / computed / effect 到底怎么共用一套底层模型”，那就再留一天在 reactivity。

## 11. 小结

第三天的核心不是把所有响应式文件都背下来，而是建立一个稳定认知：

- `ReactiveEffect.run()` 负责把“当前订阅者”放进 `activeSub`
- 响应式读取通过 `track(...)` 建立依赖
- 响应式写入通过 `trigger(...)` 通知依赖
- `reactive`、`ref`、`computed` 只是依赖载体不同，本质都在围绕 `Dep` 和 `Subscriber` 协作
- 第二天的 scheduler 不是另一套机制，而是 `ReactiveEffect.trigger()` 的下游

只要这一层想清楚了，后面你再看 `watch`、`effectScope`、`patchElement`、children diff，就不会觉得它们是分散知识点，而会自然接到同一条“变化如何被消费”的主链路上。
