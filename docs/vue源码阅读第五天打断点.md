# Vue 源码阅读第五天打断点
更新时间：2026-04-21

## 1. 第五天的目标

第五天不要继续困在 `renderer.ts` 的大 diff 里，也不要急着去编译器。  
今天只做一件事：把 `runtime-dom` 这一层走通，看清“renderer 算出来要更新什么”之后，浏览器平台到底怎样把这些变化落到真实 DOM 上。

第五天只围绕下面这条链路读源码：

1. `runtime-dom` 怎样把 `nodeOps + patchProp` 交给 `runtime-core`
2. `patchProp` 怎样把不同类型的 DOM 更新再分流
3. `class` / `style` / `attrs` / `events` 为什么拆成独立模块
4. `shouldSetAsProp` 为什么不是所有属性都直接 `el[key] = value`
5. 平台无关的 renderer 和 DOM 平台适配层到底是怎样分层的

如果你能回答“为什么 Vue 的 renderer 不直接写 DOM API”和“为什么有些属性走 prop，有些走 attr”，第五天就算过关。

## 2. 第五天先不要看什么

先不碰这些内容：

- `reactivity`
- `patchKeyedChildren`
- `compiler-core`
- `compiler-dom`
- SSR / hydration
- 自定义渲染器扩展分支

第五天的重点不是“VNode 怎么比”，而是“比完以后具体怎样改 DOM”。

## 3. 第五天的主问题

今天只围绕下面五个问题读源码：

1. `runtime-core` 为什么不直接依赖浏览器 DOM API？
2. `runtime-dom` 是怎样把平台能力注入到 renderer 里的？
3. `patchProp` 为什么要继续分流成 `class / style / attrs / events`？
4. 为什么有些更新走 DOM property，有些走 attribute？
5. 事件更新为什么不是每次都 remove + add 原生监听器？

## 3.1 这五个问题的直接答案

### 3.1.1 `runtime-core` 为什么不直接依赖浏览器 DOM API？

因为 `runtime-core` 的目标是“平台无关的渲染核心”，它只关心：

- vnode 怎样 patch
- 组件怎样 mount / update / unmount
- 调度器怎样安排更新

至于“怎么创建元素、怎么设文本、怎么插入节点、怎么改属性”，这些都属于宿主平台能力。

所以在 `runtime-core/src/renderer.ts` 里，renderer 用的是一组抽象宿主操作：

- `hostCreateElement`
- `hostInsert`
- `hostRemove`
- `hostSetElementText`
- `hostPatchProp`

而真正给这些操作提供 DOM 实现的，是 `runtime-dom`。

### 3.1.2 `runtime-dom` 是怎样把平台能力注入到 renderer 里的？

关键入口在 `packages/runtime-dom/src/index.ts`：

- `nodeOps` 提供节点级 DOM 操作
- `patchProp` 提供属性级 DOM 操作
- `rendererOptions = extend({ patchProp }, nodeOps)`
- 再把这组 options 交给 `createRenderer(rendererOptions)`

所以可以先把它理解成：

```text
runtime-core
  负责“怎么渲染”

runtime-dom
  负责“在浏览器里具体怎么做”
```

这就是 Vue 能同时支持 DOM、SSR、测试 renderer、甚至自定义 renderer 的基础。

### 3.1.3 `patchProp` 为什么要继续分流成 `class / style / attrs / events`？

因为这些 DOM 更新的语义完全不一样。

例如：

- `class` 更适合单独处理字符串、SVG 场景
- `style` 需要支持对象、字符串、旧值清理
- 事件需要处理缓存 invoker、更新时间戳、防止重复绑定
- 普通属性还要区分 prop 和 attr

所以 `packages/runtime-dom/src/patchProp.ts` 会先做一层统一分流：

```text
class  -> patchClass
style  -> patchStyle
event  -> patchEvent
其他   -> patchDOMProp 或 patchAttr
```

这不是“代码拆模块而已”，而是因为这些更新策略本来就不相同。

### 3.1.4 为什么有些更新走 DOM property，有些走 attribute？

因为浏览器 DOM 上有两套概念：

- property：JS 对象字段，如 `el.value`、`el.checked`
- attribute：HTML 属性，如 `setAttribute('id', ...)`

Vue 在 `patchProp.ts` 里会通过 `shouldSetAsProp(...)` 判断：

- 如果更符合 DOM property 语义，就走 prop
- 否则走 `patchAttr(...)`

例如：

- `value`、`checked` 这类通常更适合走 prop
- 某些 SVG 属性、普通字符串属性更适合走 attr

所以第五天一定要建立一个稳定认知：  
Vue 不是“统一用 setAttribute”，而是在替你做平台语义判断。

### 3.1.5 事件更新为什么不是每次都 remove + add 原生监听器？

因为那样成本高，而且会让频繁更新场景下的事件处理更抖。

`packages/runtime-dom/src/modules/events.ts` 的关键设计是：

- DOM 上只尽量保持稳定的原生监听器
- 真正变的是监听器内部持有的回调引用

也就是常说的 invoker 模型。

可以先理解成：

```text
patchEvent
  -> 复用已有 invoker
  -> 只更新 invoker.value
  -> 尽量不反复 add/remove 原生事件
```

所以事件更新的重点不是“每次重绑”，而是“复用外壳，替换内部回调”。

## 4. 推荐最小 demo

第五天建议准备一个能同时观察 class、style、attr、prop、event 的 demo：

```html
<div id="app"></div>
<script src="../../dist/vue.global.js"></script>
<script>
  const { createApp, h, ref } = Vue

  const App = {
    setup() {
      const ok = ref(false)
      const text = ref('hello')

      const onClickA = () => console.log('A')
      const onClickB = () => console.log('B')

      window.flip = () => {
        ok.value = !ok.value
      }

      return () =>
        h('div', [
          h('input', {
            class: ok.value ? 'on' : 'off',
            style: { color: ok.value ? 'tomato' : 'teal' },
            value: text.value,
            title: ok.value ? 'yes' : 'no',
            onClick: ok.value ? onClickA : onClickB,
          }),
        ])
    },
  }

  createApp(App).mount('#app')
</script>
```

这个 demo 主要看四件事：

- `class` 更新为什么进 `patchClass`
- `style` 更新为什么进 `patchStyle`
- `value` 更新为什么更接近 prop
- 点击事件切换时，为什么不会每次都重新绑一遍原生监听器

## 5. 推荐断点顺序

### 5.1 `packages/runtime-dom/src/index.ts`

重点看：

- `rendererOptions`
- `ensureRenderer`
- `createRenderer(rendererOptions)`

先确认：

```text
nodeOps + patchProp
  -> rendererOptions
  -> createRenderer
```

第五天先把“平台层注入”这件事看明白，后面再看细分模块。

### 5.2 `packages/runtime-dom/src/nodeOps.ts`

重点看：

- `insert`
- `remove`
- `createElement`
- `createText`
- `setText`
- `setElementText`

这一层主要解决一个问题：

`runtime-core` 里那些抽象的 host 操作，到了 DOM 平台具体对应哪些浏览器 API。

### 5.3 `packages/runtime-dom/src/patchProp.ts`

这是第五天最核心的文件。

重点看：

- `patchProp`
- `shouldSetAsProp`

你要先看懂一层总分流：

```text
patchProp
  -> class
  -> style
  -> event
  -> prop / attr
```

### 5.4 `packages/runtime-dom/src/modules/class.ts`

重点看：

- `patchClass`

这部分相对简单，主要确认：

- class 更新为什么单独做
- SVG 场景为什么也要区分

### 5.5 `packages/runtime-dom/src/modules/style.ts`

重点看：

- `patchStyle`

这里要重点观察：

- 字符串 style 和对象 style 的不同处理
- 旧样式字段怎样被清掉

### 5.6 `packages/runtime-dom/src/modules/attrs.ts`

重点看：

- `patchAttr`

这里主要确认：

- attr 更新最终怎样落到 `setAttribute/removeAttribute`
- 布尔属性、SVG 等场景为什么要特殊处理

### 5.7 `packages/runtime-dom/src/modules/events.ts`

这是第五天最值得细看的模块。

重点看：

- `patchEvent`
- invoker 的创建和复用

你要重点观察：

- 第一次绑定事件时发生了什么
- 事件回调变更时为什么通常只是更新 invoker
- 什么时候才真的 removeEventListener

## 6. 第五天你应该重点观察到的事实

### 6.1 `runtime-core` 只定义渲染协议，不直接写 DOM

所以 Vue 的 renderer 才能平台无关。

### 6.2 `runtime-dom` 的核心职责就是提供 DOM 版宿主实现

也就是 `nodeOps + patchProp`。

### 6.3 `patchProp` 本身不是最终落点，而是属性更新总分发器

真正干活的是各个模块。

### 6.4 prop 和 attr 不是一个东西

Vue 会替你根据平台语义做判断。

### 6.5 事件更新的重点是复用 invoker

而不是反复解绑再重绑原生事件。

## 7. 推荐记录方式

第五天建议至少沉淀这三份输出。

### 7.1 一张平台分层图

```text
runtime-core
  -> host ops
runtime-dom
  -> nodeOps + patchProp
```

### 7.2 一张 `patchProp` 分流图

```text
patchProp
  -> class
  -> style
  -> events
  -> prop / attr
```

### 7.3 一张事件更新图

```text
onClick 更新
  -> patchEvent
  -> 复用 invoker
  -> 更新 invoker.value
```

## 8. 第五天完成标准

当你能回答下面这些问题，第五天就算过关了：

1. `runtime-core` 为什么不直接依赖 DOM API？
2. `runtime-dom` 是怎样把平台能力注入 renderer 的？
3. `patchProp` 为什么还要再分流？
4. `shouldSetAsProp` 在解决什么问题？
5. prop 和 attr 的区别是什么？
6. 为什么事件更新通常不会每次都重新绑原生监听器？
7. `class / style / attrs / events` 为什么适合独立模块化？

## 9. 推荐的第五天阅读顺序

1. `packages/runtime-dom/src/index.ts`
2. `packages/runtime-dom/src/nodeOps.ts`
3. `packages/runtime-dom/src/patchProp.ts`
4. `packages/runtime-dom/src/modules/class.ts`
5. `packages/runtime-dom/src/modules/style.ts`
6. `packages/runtime-dom/src/modules/attrs.ts`
7. `packages/runtime-dom/src/modules/events.ts`

## 10. 第六天怎么接

第五天结束后，第六天最自然的衔接就是进入 `compiler-core`：

- 看模板怎么 parse 成 AST
- 看 transform 怎样分析节点
- 看 codegen 怎样产出 render code

## 11. 小结

第五天的核心不是背 DOM 细节，而是建立一个稳定认知：

- `runtime-core` 负责通用渲染流程
- `runtime-dom` 负责浏览器平台落地
- `patchProp` 是属性更新总分发器
- 事件、样式、属性、class 的平台语义并不相同

只要这一层想清楚了，后面再看编译器生成的 patch flag 和 block tree，就能更清楚这些优化信息最终落到哪里。
