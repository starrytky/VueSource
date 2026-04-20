# Vue 源码阅读第四天打断点
更新时间：2026-04-21

## 1. 第四天的目标

第四天不要再回头扩散到 `reactivity`，也不要直接跳去编译器。  
今天只做一件事：把组件更新后半段的 `renderer diff` 主链走通，重点看 `patchElement`、`patchChildren`、`patchKeyedChildren`。

第四天只围绕下面这条链路读源码：

1. 组件更新进入 `patch(prevTree, nextTree)`
2. 同类型元素为什么会走 `patchElement`
3. 元素更新时，props 和 children 是怎样分开处理的
4. children 更新为什么会继续分流成文本、数组、无子节点三类
5. keyed diff 为什么既能复用节点，又能处理移动和删除
6. Vue 为什么要在“能不动就不动”的前提下，尽量减少 DOM 移动

如果你能回答“为什么同一个元素更新不会重新 mount”和“keyed diff 为什么要算最长递增子序列”，第四天就算过关。

## 2. 第四天先不要看什么

先不碰这些内容：

- `reactivity` 的底层实现细节
- `runtime-dom` 的 `patchProp`、事件、样式模块
- `compiler-core`
- `Transition` / `Teleport` / `Suspense`
- SSR / hydration

第四天的重点不是“变化为什么发生”，而是“变化来到 renderer 之后，新旧 vnode 怎样被比较并落成最少的 DOM 操作”。

## 3. 第四天的主问题

今天只围绕下面五个问题读源码：

1. 同类型元素更新时，为什么走 `patchElement` 而不是重新 `mountElement`？
2. `patchElement` 内部为什么先处理 props，再处理 children？
3. `patchChildren` 是怎样在文本 / 数组 / 空三种 children 之间分流的？
4. `patchKeyedChildren` 为什么先做“头尾同步”，再处理中间乱序段？
5. 最长递增子序列在 keyed diff 里到底解决了什么问题？

## 3.1 这五个问题的直接答案

### 3.1.1 同类型元素更新时，为什么走 `patchElement` 而不是重新 `mountElement`？

因为在 `packages/runtime-core/src/renderer.ts` 的 `patch` 里，Vue 会先判断新旧 vnode 是否是同一种类型。

如果：

- 标签类型相同
- key 没让它们变成“不同节点”

那么这就不是“卸载旧节点、挂载新节点”的问题，而是“复用旧 DOM，按差异更新”的问题，所以会进入：

```text
patch(...)
  -> processElement(...)
  -> patchElement(...)
```

这里最重要的认知是：

- `mountElement` 负责“从 0 到 1 创建 DOM”
- `patchElement` 负责“复用已有 DOM 做增量更新”

所以同类型元素更新时，Vue 的目标不是重新建 DOM，而是尽量复用 `n1.el`。

### 3.1.2 `patchElement` 内部为什么先处理 props，再处理 children？

因为元素更新本质上就是两类变化：

- 节点自身属性变化
- 子内容变化

在 `patchElement` 里，Vue 会先把新旧 vnode 的 `el` 对齐，再根据优化信息和 flags 先做一轮 props 处理，然后继续调用 `patchChildren(...)`。

可以先把它理解成：

```text
patchElement
  -> 复用 el
  -> 更新 props
  -> 更新 children
```

先处理 props 的原因并不是绝对语义要求，而是 renderer 在这里把“当前元素本身”和“子树内容”明确拆成两个阶段，方便：

- 利用 patch flag 优化属性更新
- 把 children diff 独立成统一入口

所以第四天要先建立一个稳定认知：  
元素更新不是一坨逻辑，而是“当前节点自身更新 + 子节点更新”两段。

### 3.1.3 `patchChildren` 是怎样在文本 / 数组 / 空三种 children 之间分流的？

关键依据是新旧 vnode 的 `shapeFlag`。

`patchChildren` 会先看：

- 新 children 是文本
- 还是数组
- 还是没有 children

然后再结合旧 children 的形态决定：

- 文本替换文本
- 文本替换数组
- 数组和数组走 diff
- 新 children 为空时卸载旧 children

所以可以把 `patchChildren` 粗略记成：

```text
文本 -> 直接设文本
数组 -> 继续看是否需要 diff
空   -> 卸载旧 children
```

第四天不需要一上来就背完整分支，但一定要知道：  
children diff 的第一层分流不是看 DOM，而是看 vnode children 的形态。

### 3.1.4 `patchKeyedChildren` 为什么先做“头尾同步”，再处理中间乱序段？

因为真实更新里，最常见的情况不是“整段全乱”，而是：

- 前面一部分相同
- 后面一部分相同
- 中间一小段发生插入、删除、交换顺序

所以 `patchKeyedChildren` 的策略是：

1. 从头开始，能同步就同步
2. 从尾开始，能同步就同步
3. 只把真正有变化的中间区间拿出来精细处理

这样做的收益很直接：

- 少比较很多本来就没变的节点
- 把真正复杂的部分压缩到中间区间
- 后面的“新建 / 删除 / 移动”都只针对这一小段做

所以它不是“为了好看分三段”，而是为了降低比较范围。

### 3.1.5 最长递增子序列在 keyed diff 里到底解决了什么问题？

它解决的是：  
在“新旧节点都还能复用，但顺序变了”的情况下，怎样找出“其实不用动的那一批节点”，从而把 DOM 移动次数降到更少。

在 `patchKeyedChildren` 的中间乱序段里，Vue 会先建立：

- 新 key 到新索引的映射
- 旧节点在新序列中的位置数组

然后求这段数组的最长递增子序列。

含义是：

- 这条递增子序列里的节点，相对顺序已经稳定
- 它们可以原地复用，不需要移动
- 不在这条序列里的节点，才是需要移动的

所以 LIS 不是为了“判断谁变了”，而是为了“在已经确认都能复用的前提下，尽量少 move”。

## 4. 推荐最小 demo

第四天建议准备一个能触发 props 更新、文本 children 更新、数组 children 重排的 demo：

```html
<div id="app"></div>
<script src="../../dist/vue.global.js"></script>
<script>
  const { createApp, h, ref } = Vue

  const App = {
    setup() {
      const ok = ref(true)
      const color = ref('tomato')
      const list = ref([
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
        { id: 'c', text: 'C' },
      ])

      window.flipText = () => {
        ok.value = !ok.value
      }

      window.swap = () => {
        list.value = [
          { id: 'b', text: 'B' },
          { id: 'a', text: 'A' },
          { id: 'd', text: 'D' },
          { id: 'c', text: 'C' },
        ]
      }

      window.repaint = () => {
        color.value = color.value === 'tomato' ? 'teal' : 'tomato'
      }

      return () =>
        h('section', { class: 'box', style: { color: color.value } }, [
          h('button', { onClick: repaint }, 'toggle color'),
          ok.value ? h('p', 'text child') : h('p', [h('span', 'array child')]),
          h(
            'ul',
            list.value.map(item =>
              h('li', { key: item.id }, item.text)
            )
          ),
        ])
    },
  }

  createApp(App).mount('#app')
</script>
```

这个 demo 主要看三件事：

- `style` 变化时，为什么是 `patchElement` 而不是重新创建元素
- 文本 children 和数组 children 切换时，`patchChildren` 怎样分流
- `swap()` 后，哪些 `li` 被复用、哪些被移动、哪些被新建

## 5. 推荐断点顺序

### 5.1 `packages/runtime-core/src/renderer.ts`

第四天主要盯住下面这些函数：

- `patch`
- `processElement`
- `mountElement`
- `patchElement`
- `patchChildren`
- `patchKeyedChildren`
- `move`
- `unmount`

#### 5.1.1 先看 `patch -> processElement`

先确认：

```text
首次挂载
  -> processElement
  -> mountElement

同类型更新
  -> processElement
  -> patchElement
```

这一步最重要的是分清“挂载”和“更新”已经不是同一条路径了。

#### 5.1.2 再看 `patchElement`

重点观察：

- `el` 是怎样从旧 vnode 复用到新 vnode 的
- props 更新和 children 更新在哪两段完成
- block / patch flag 优化分支大概插在什么位置

第四天不要求你把每个优化分支都吃透，但一定要看到：

`patchElement` 是元素更新的真正主入口。

#### 5.1.3 再看 `patchChildren`

这里重点看三类情况：

- 新 children 是文本
- 新 children 是数组
- 新 children 为空

你要重点观察：

- 文本替换旧数组时，旧 children 是怎么被卸载的
- 数组和数组时，什么时候继续进入 `patchKeyedChildren`
- 空 children 时，旧内容是怎样被清掉的

#### 5.1.4 最后看 `patchKeyedChildren`

第四天最核心的源码阅读重点就在这里。

建议按下面顺序理解：

1. 头部同步
2. 尾部同步
3. 新增节点
4. 删除节点
5. 中间乱序段映射
6. LIS 与移动

看到这里时，你要至少建立两个稳定认知：

- key 的意义不是“只是让 Vue 不警告”
- keyed diff 的目标不是“重新排一遍”，而是“尽量复用、尽量少动”

### 5.2 `move` / `unmount`

看完 `patchKeyedChildren` 后，再补看：

- `move`
- `unmount`
- `unmountChildren`

因为第四天你要真正把“新增 / 删除 / 移动”三类实际 DOM 行为和前面的 diff 结果对上。

## 6. 第四天你应该重点观察到的事实

### 6.1 相同元素更新时，核心不是重建，而是复用 DOM

真正被复用的是旧 vnode 上已经存在的 `el`。

### 6.2 children diff 的第一层判断来自 vnode 形态，不是直接操作 DOM

也就是先看新旧 children 是文本、数组还是空。

### 6.3 keyed diff 的复杂度主要集中在“中间乱序段”

头尾能同步的部分都会被先跳过。

### 6.4 key 决定的是节点身份，不只是列表消警告

没有稳定 key，就很难可靠复用旧节点。

### 6.5 最长递增子序列解决的是“减少 move”，不是“找到所有变化”

这是第四天最容易理解偏的地方。

## 7. 推荐记录方式

第四天建议至少沉淀这三份输出。

### 7.1 一张元素更新总图

```text
patch
  -> processElement
  -> patchElement
  -> patchChildren
```

### 7.2 一张 children 分流图

```text
新 children
  -> 文本
  -> 数组
  -> 空
```

### 7.3 一张 keyed diff 步骤图

```text
头同步
  -> 尾同步
  -> 新增 / 删除
  -> 中间映射
  -> LIS
  -> move / mount
```

## 8. 第四天完成标准

当你能回答下面这些问题，第四天就算过关了：

1. 为什么同类型元素更新时会走 `patchElement`？
2. `patchElement` 里 props 和 children 是怎样分开处理的？
3. `patchChildren` 第一层是按什么维度分流的？
4. 为什么 `patchKeyedChildren` 先做头尾同步？
5. key 在 diff 里到底提供了什么能力？
6. 为什么 Vue 要算最长递增子序列？
7. 哪些节点会被 move，哪些节点可以原地复用？

## 9. 推荐的第四天阅读顺序

1. `packages/runtime-core/src/renderer.ts`
2. `patch -> processElement`
3. `mountElement / patchElement`
4. `patchChildren`
5. `patchKeyedChildren`
6. `move / unmount`

## 10. 第五天怎么接

第四天结束后，第五天最自然的衔接就是进入 `runtime-dom`：

- 看 `patchProp`
- 看 `class / style / attrs / events`
- 把“renderer 算出来要更新什么”接到“浏览器 DOM 具体怎么改”

## 11. 小结

第四天的核心不是把 diff 代码背下来，而是建立一个稳定认知：

- `renderer` 更新元素时优先复用 DOM
- children 更新先按形态分流，再进入更细的 diff
- keyed diff 的目标是“尽量复用、尽量少 move”
- LIS 是优化 DOM 移动次数的关键，而不是 diff 的全部

只要这一层想清楚了，后面再看 `runtime-dom` 的属性更新和编译器的 patch flag，理解会顺很多。
