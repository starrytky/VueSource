# Vue 源码阅读第六天打断点
更新时间：2026-04-21

## 1. 第六天的目标

第六天不要继续停留在 runtime，也不要一上来就看 `.vue` 单文件组件。  
今天只做一件事：把 `compiler-core` 的三段式主链走通，搞清模板是怎样从字符串变成 render code 的。

第六天只围绕下面这条链路读源码：

1. `baseCompile(template)` 怎样串起 parse、transform、codegen
2. 模板字符串怎样先变成 AST
3. transform 为什么是编译器最关键的一层
4. `transformElement`、`transformText`、`transformIf`、`transformFor` 分别做了什么
5. codegen 最后为什么会生成 `openBlock`、`createElementBlock`、helper 导入这些运行时代码

如果你能回答“为什么 transform 是编译器最关键的一层”和“render 函数代码到底从哪里来”，第六天就算过关。

## 2. 第六天先不要看什么

先不碰这些内容：

- `runtime-dom`
- `compiler-sfc`
- SSR compiler
- 样式编译
- `script setup` 宏展开

第六天的重点不是“`.vue` 文件怎么拆”，而是“模板编译这件事在最核心层面怎样完成”。

## 3. 第六天的主问题

今天只围绕下面五个问题读源码：

1. `baseCompile` 怎样把 parse、transform、codegen 串成完整主链？
2. AST 在 Vue 编译器里承担什么角色？
3. 为什么说 transform 是编译器最关键的一层？
4. `transformElement / transformText / transformIf / transformFor` 分别解决什么问题？
5. codegen 为什么会产出运行时 helper 调用，而不是直接生成 DOM 操作？

## 3.1 这五个问题的直接答案

### 3.1.1 `baseCompile` 怎样把 parse、transform、codegen 串成完整主链？

关键入口在 `packages/compiler-core/src/compile.ts` 的 `baseCompile(...)`。

它做的事情可以先压成三步：

```text
template
  -> baseParse
  -> transform
  -> generate
```

也就是说：

- parse 负责把模板字符串解析成 AST
- transform 负责在 AST 上做语义分析和重写
- codegen 负责把处理后的 AST 输出成 render code

第六天一定要先建立这条主链，不然后面看单个 transform 很容易碎。

### 3.1.2 AST 在 Vue 编译器里承担什么角色？

AST 是模板在“可分析、可改写”阶段的统一中间表示。

原因很简单：

- 原始模板字符串不适合直接做复杂分析
- render code 又太接近最终输出，不适合做结构性转换

所以 AST 正好处在中间：

- 既保留了模板结构
- 又方便 transform 阶段遍历、标记、替换、提升

所以第六天要建立一个稳定认知：  
AST 不是编译器的副产品，而是 transform 阶段真正工作的对象。

### 3.1.3 为什么说 transform 是编译器最关键的一层？

因为 parse 更多是在“还原结构”，codegen 更多是在“打印结果”，真正决定模板会被怎样优化、怎样映射到运行时的，是 transform。

在 `packages/compiler-core/src/transform.ts` 里，Vue 会：

- 创建 transform context
- 深度遍历 AST
- 依次应用 node transforms 和 directive transforms
- 在节点上挂 codegenNode、patch flag、helper 信息

也就是说：

- parse 产出“原始 AST”
- transform 决定“这个 AST 最终该变成什么样”
- codegen 只是把 transform 的结果输出成代码

所以 transform 才是编译器里最值得花时间啃的一层。

### 3.1.4 `transformElement / transformText / transformIf / transformFor` 分别解决什么问题？

可以先这样记：

- `transformElement`
  负责把普通元素 / 组件节点组织成最终的 vnode codegen 结构，并分析 props、dynamic props、patch flag
- `transformText`
  负责合并、规范化文本与插值节点，决定什么时候生成 `TEXT` 类更新信息
- `transformIf`
  负责把 `v-if / v-else-if / v-else` 变成条件分支 codegen
- `transformFor`
  负责把 `v-for` 变成循环渲染结构，并标记 fragment/keyed 相关信息

也就是说，第六天不要把这些 transform 看成“很多孤立插件”，而要把它们看成：

“把模板语义逐步翻译成运行时可执行结构”的几类核心规则。

### 3.1.5 codegen 为什么会产出运行时 helper 调用，而不是直接生成 DOM 操作？

因为 Vue 编译器的输出目标不是“浏览器专用 DOM 指令”，而是“调用 runtime 的 render 函数代码”。

所以你会在 codegen 结果里看到：

- `openBlock`
- `createElementBlock`
- `createVNode`
- `toDisplayString`

这类 helper 调用。

原因是：

- 编译器负责静态分析和代码生成
- runtime 负责真正执行这些 helper，产出 vnode 并驱动 patch

所以第六天一定要建立一个认知：  
Vue 的模板编译输出不是最终 DOM 操作，而是“更适合交给 runtime 执行的 vnode 构建代码”。

## 4. 推荐最小 demo

第六天建议先用一段短模板观察 compile 结果：

```html
<div class="card">
  <p>{{ msg }}</p>
  <span v-if="ok">yes</span>
  <ul>
    <li v-for="item in list" :key="item.id">{{ item.text }}</li>
  </ul>
</div>
```

建议你在调试时重点观察：

- parse 后 AST 长什么样
- transform 后哪些节点多了 `codegenNode`
- generate 后 render code 里出现了哪些 helper

## 5. 推荐断点顺序

### 5.1 `packages/compiler-core/src/compile.ts`

重点看：

- `baseCompile`

先确认最短主链：

```text
baseCompile
  -> baseParse
  -> transform
  -> generate
```

第六天先把主链抓住，再往里钻。

### 5.2 `packages/compiler-core/src/parser.ts`

重点看：

- `baseParse`

这一层主要解决：

- 模板字符串怎样被解析成节点树
- 根节点、元素节点、文本节点、插值节点怎样出现

第六天在 parse 阶段不用死抠每个字符扫描细节，只要先看懂“字符串 -> AST”。

### 5.3 `packages/compiler-core/src/transform.ts`

这是第六天最核心的文件。

重点看：

- `createTransformContext`
- `transform`
- 遍历和退出回调逻辑

你要重点观察：

- transform context 里维护了哪些 helper / scope / cache 信息
- 节点遍历时 transforms 是怎样被依次应用的
- 为什么很多 transform 都会返回 exit 函数

### 5.4 `packages/compiler-core/src/transforms/transformElement.ts`

重点看：

- `transformElement`

这里要重点看懂：

- 元素 vnode codegen 是在哪里被真正组织出来的
- props 分析和 patch flag 决策大概发生在哪

### 5.5 `packages/compiler-core/src/transforms/transformText.ts`

重点看：

- `transformText`

这里主要看：

- 相邻文本 / 插值节点怎样被合并
- 为什么有些文本节点会带上 `TEXT` 相关更新信息

### 5.6 `packages/compiler-core/src/transforms/vIf.ts`

重点看：

- `transformIf`

这一层主要确认：

- 条件分支怎样变成 codegen 分支
- 为什么最终生成的是条件表达式 / block 结构

### 5.7 `packages/compiler-core/src/transforms/vFor.ts`

重点看：

- `transformFor`

这里重点确认：

- `v-for` 为什么常常会生成 fragment
- key / stable fragment / keyed fragment 这类信息大概在哪个阶段被挂上去

### 5.8 `packages/compiler-core/src/codegen.ts`

重点看：

- `generate`

最后确认：

- helper 导入是怎样被打印出来的
- render 函数体是怎样拼出来的
- 为什么会看到 `openBlock`、`createElementBlock` 这些运行时 helper

## 6. 第六天你应该重点观察到的事实

### 6.1 `baseCompile` 真正串起了编译器三段式主链

所以它是第六天最重要的总入口。

### 6.2 AST 是 transform 的工作舞台

不是 parse 的附带结果。

### 6.3 transform 决定了模板语义如何映射到运行时结构

这是编译器最有价值的一层。

### 6.4 codegen 输出的是 runtime helper 调用

而不是直接 DOM 指令。

### 6.5 模板优化信息的来源并不在 runtime，而在编译期分析

runtime 只是消费这些结果。

## 7. 推荐记录方式

第六天建议至少沉淀这三份输出。

### 7.1 一张编译三阶段总图

```text
template
  -> parse
  -> transform
  -> codegen
  -> render code
```

### 7.2 一张 AST 到 codegenNode 的变化图

```text
原始 AST
  -> transform 后挂 codegenNode
  -> generate 输出代码
```

### 7.3 一张核心 transform 对照表

| transform | 作用 |
| --- | --- |
| `transformElement` | 组织 vnode codegen 与 props 分析 |
| `transformText` | 合并文本节点与插值 |
| `transformIf` | 处理条件分支 |
| `transformFor` | 处理循环与 fragment 结构 |

## 8. 第六天完成标准

当你能回答下面这些问题，第六天就算过关了：

1. `baseCompile` 怎样串起 parse、transform、generate？
2. AST 在 Vue 编译器里承担什么角色？
3. 为什么说 transform 是编译器最关键的一层？
4. `transformElement / transformText / transformIf / transformFor` 分别在做什么？
5. codegen 为什么输出的是 helper 调用？
6. render code 和 runtime 的关系是什么？
7. 模板优化信息大致是在什么阶段决定的？

## 9. 推荐的第六天阅读顺序

1. `packages/compiler-core/src/compile.ts`
2. `packages/compiler-core/src/parser.ts`
3. `packages/compiler-core/src/transform.ts`
4. `packages/compiler-core/src/transforms/transformElement.ts`
5. `packages/compiler-core/src/transforms/transformText.ts`
6. `packages/compiler-core/src/transforms/vIf.ts`
7. `packages/compiler-core/src/transforms/vFor.ts`
8. `packages/compiler-core/src/codegen.ts`

## 10. 第七天怎么接

第六天结束后，第七天最自然的衔接就是进入 `compiler-dom`：

- 看 DOM 平台对编译器补了什么增强
- 看 patch flag、block tree、DOM 指令转换怎样接到 runtime 优化

## 11. 小结

第六天的核心不是把编译器所有实现细节都背下来，而是建立一个稳定认知：

- `baseCompile` 串起三段式主链
- AST 是模板到代码之间的关键中间层
- transform 是最重要的语义翻译阶段
- codegen 最终输出的是 runtime helper 调用

只要这一层想清楚了，后面再看 `compiler-dom`、`compiler-sfc` 和 patch flag，就不会觉得编译器和 runtime 是两套割裂知识。
