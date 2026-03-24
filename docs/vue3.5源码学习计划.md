# Vue 3.5 源码学习计划
更新时间：2026-03-24

## 1. 学习目标

这份计划的目标，不是“把 Vue 仓库从头到尾读一遍”，而是建立一套可以反复复用的源码理解框架，最终达到下面几个结果：

- 能说清 Vue 3.5 的整体分层：`reactivity`、`runtime-core`、`runtime-dom`、`compiler-*`、`server-renderer`
- 能独立追踪一个常见功能从模板到运行时的完整链路
- 能理解组件挂载、更新、卸载、调度、依赖收集、编译优化这些核心机制
- 能把 Vue 3.5 相比早期 3.x 版本的重要变化单独拎出来理解，而不是混在旧资料里
- 能通过源码、测试、最小 demo 三种视角交叉验证，而不是只停留在“看懂函数名”

最终预期不是背 API，而是回答这类问题：

- `ref`、`reactive`、`computed`、`watch` 到底怎么协作？
- 组件更新为什么会合并？调度器怎样避免重复执行？
- `patch` 是怎么比较新旧 vnode 的？
- 模板为什么能编译出更少的运行时代码？
- Vue 3.5 新增或调整的能力，分别落在哪些模块？

## 2. 学习边界

### 2.1 这份计划重点学什么

- 响应式系统
- 组件实例与渲染流程
- 调度器与更新机制
- 编译器主流程
- DOM 渲染适配层
- SSR / hydration 基础链路
- Vue 3.5 重点改动专题

### 2.2 这份计划暂时不重点学什么

- 历史版本兼容细节
- Vue 2 到 Vue 3 的完整迁移实现
- Devtools 内部通信细节
- 非核心平台适配分支
- 每一个边缘 API 的源码穷举

先把主干读通，再补枝叶，否则很容易陷入“知道很多局部实现，但整体链路断裂”的状态。

## 3. 阅读原则

### 3.1 先主链路，后支线

优先看最常见路径：

1. 响应式对象创建
2. 组件挂载
3. 模板编译
4. 状态变更触发更新
5. DOM patch

不要一开始就钻进 `Transition`、`Suspense`、`KeepAlive` 这类增强能力，否则会被大量分支逻辑打断。

### 3.2 先输入输出，再看实现细节

每读一个模块，先回答三个问题：

- 它接收什么输入？
- 它输出什么结果？
- 它解决哪个阶段的问题？

如果这三个问题说不清，继续深挖局部函数意义不大。

### 3.3 源码、测试、示例一起看

建议每个阶段都同时准备三份材料：

- 源码：看真实实现
- 测试：看边界与预期行为
- demo：看运行结果和断点现场

测试不是补充材料，而是理解“作者认为这个模块必须保证什么”的最快入口。

### 3.4 一定要自己画链路图

建议每完成一个主题，就至少产出一种可复用笔记：

- 模块职责图
- 调用时序图
- 关键对象关系图
- 术语对照表

源码学习如果没有自己的结构化输出，很容易一周后只剩印象。

## 4. 源码总览

建议先建立一张模块地图，再正式进入阅读。

```text
packages/
  shared/
  reactivity/
  runtime-core/
  runtime-dom/
  compiler-core/
  compiler-dom/
  compiler-sfc/
  server-renderer/
```

建议先理解各包职责：

- `shared`：共享工具、类型判断、标记常量
- `reactivity`：依赖收集、触发更新、`ref`、`reactive`、`computed`
- `runtime-core`：vnode、组件实例、渲染主流程、调度器、生命周期、`watch`
- `runtime-dom`：DOM 平台适配，属性、事件、样式、class patch
- `compiler-core`：模板编译的 parser / transform / codegen 核心
- `compiler-dom`：面向浏览器 DOM 的编译增强
- `compiler-sfc`：`.vue` 文件解析与 `script/template/style` 编译
- `server-renderer`：服务端渲染与 hydration 相关能力

## 5. 推荐学习顺序

建议按下面顺序推进，而不是按仓库目录机械阅读：

1. `shared`
2. `reactivity`
3. `runtime-core`
4. `runtime-dom`
5. `compiler-core`
6. `compiler-dom`
7. `compiler-sfc`
8. `server-renderer`
9. Vue 3.5 重点专题回看

原因很简单：

- 不理解响应式，就看不懂更新为什么发生
- 不理解 `runtime-core`，就看不懂 vnode 和组件如何驱动渲染
- 不理解编译器，就不知道模板优化为什么成立
- 不理解 3.5 重点改动，就容易把旧版本文章当成现状

## 6. 分阶段学习路线

### 6.1 第一阶段：准备工作与入口建立

目标：

- 跑通 Vue 源码仓库
- 找到开发入口、测试入口、构建入口
- 明确不同 package 之间的依赖关系

建议任务：

- 看根目录脚本、工作区配置、构建配置
- 确认 `packages/*` 的职责边界
- 找一个最简单示例，从 `createApp(...).mount(...)` 开始打断点
- 记录“从入口到首屏渲染”经过了哪些核心函数

阶段产出：

- 一份仓库结构说明
- 一张首屏挂载主链路图

### 6.2 第二阶段：响应式系统

目标：

- 理解依赖收集与触发更新的基本模型
- 读懂 `ref`、`reactive`、`computed` 的实现差异
- 建立 effect、dep、proxy 之间的关系图

重点文件建议：

- `packages/reactivity/src/reactive.ts`
- `packages/reactivity/src/baseHandlers.ts`
- `packages/reactivity/src/ref.ts`
- `packages/reactivity/src/computed.ts`
- `packages/reactivity/src/effect.ts`
- `packages/reactivity/src/dep.ts`
- `packages/reactivity/src/effectScope.ts`

核心问题：

- `reactive` 为什么要基于 `Proxy`？
- `track` 和 `trigger` 分别在什么时机触发？
- `ref` 和 `reactive` 在依赖收集上有什么不同？
- `computed` 为什么默认是惰性的？
- effect 嵌套、清理、停止是怎么处理的？

阶段产出：

- 一份响应式核心对象关系图
- 一份 `ref/reactive/computed` 差异对照表
- 一个最小版响应式实现练习

### 6.3 第三阶段：组件实例与运行时核心

目标：

- 理解 vnode 是怎样创建和消费的
- 理解组件实例是如何建立的
- 理解 setup、render、props、slots、emit 的串联关系

重点文件建议：

- `packages/runtime-core/src/vnode.ts`
- `packages/runtime-core/src/component.ts`
- `packages/runtime-core/src/componentProps.ts`
- `packages/runtime-core/src/componentSlots.ts`
- `packages/runtime-core/src/componentEmits.ts`
- `packages/runtime-core/src/apiCreateApp.ts`
- `packages/runtime-core/src/h.ts`

核心问题：

- vnode 的最小必要信息是什么？
- 组件实例在 Vue 内部到底长什么样？
- `setup()` 返回对象和返回渲染函数时，分支如何处理？
- props、attrs、slots 在初始化时如何区分？
- `emit` 为什么能拿到组件声明的事件信息？

阶段产出：

- 一张组件实例结构图
- 一张组件挂载时序图
- 一份 `setup -> render -> patch` 链路笔记

### 6.4 第四阶段：调度器与组件更新

目标：

- 理解“状态变化后为什么不是立刻同步重渲染”
- 理解队列、去重、批处理、nextTick 背后的实现
- 搞清组件更新与 watcher 刷新的先后关系

重点文件建议：

- `packages/runtime-core/src/scheduler.ts`
- `packages/runtime-core/src/renderer.ts`
- `packages/runtime-core/src/apiWatch.ts`

核心问题：

- job 队列怎么去重？
- 为什么组件更新通常是异步批处理？
- pre / post / sync flush 分别适合什么场景？
- `watch` 和组件渲染 effect 有什么关系？
- 更新过程中如何避免无限递归和重复入队？

阶段产出：

- 一张调度队列流程图
- 一份 `watch / watchEffect / component update` 执行时机对照表

### 6.5 第五阶段：渲染器与 DOM patch

目标：

- 理解 `createRenderer` 的职责边界
- 理解元素、组件、文本、Fragment 等不同 vnode 分支如何 patch
- 理解 keyed diff、卸载、移动、复用这些核心行为

重点文件建议：

- `packages/runtime-core/src/renderer.ts`
- `packages/runtime-core/src/rendererTemplateRef.ts`
- `packages/runtime-dom/src/index.ts`
- `packages/runtime-dom/src/patchProp.ts`
- `packages/runtime-dom/src/modules/class.ts`
- `packages/runtime-dom/src/modules/style.ts`
- `packages/runtime-dom/src/modules/events.ts`
- `packages/runtime-dom/src/modules/attrs.ts`

核心问题：

- 首次挂载和更新 patch 的主分支怎么分流？
- keyed children diff 的目标是什么？
- DOM 属性、事件、样式为何拆成多个模块？
- 模板 ref 在挂载和卸载时怎么处理？
- 平台无关能力和 DOM 相关能力是怎样分层的？

阶段产出：

- 一张 `patch` 分支总图
- 一份 diff 过程的步骤化笔记
- 一个最小版 renderer 实验

### 6.6 第六阶段：编译器核心

目标：

- 理解模板编译为什么能减少运行时开销
- 理解 parser、transform、codegen 三段式结构
- 看懂静态提升、patch flag、block tree 的作用

重点文件建议：

- `packages/compiler-core/src/ast.ts`
- `packages/compiler-core/src/parse.ts`
- `packages/compiler-core/src/transform.ts`
- `packages/compiler-core/src/codegen.ts`
- `packages/compiler-core/src/transforms/*`
- `packages/compiler-dom/src/index.ts`
- `packages/compiler-dom/src/transforms/*`

核心问题：

- AST 在 Vue 编译器里承担什么角色？
- transform 阶段为什么最关键？
- 哪些信息会被提前分析并喂给运行时？
- patch flag 为何能加速更新？
- `compiler-dom` 相比 `compiler-core` 额外处理了什么？

阶段产出：

- 一张模板编译三阶段流程图
- 一份“模板语法 -> AST -> render code”对照样例

### 6.7 第七阶段：SFC 编译链路

目标：

- 理解 `.vue` 单文件组件是如何被拆解和编译的
- 理解 `script setup`、模板编译、样式编译之间如何协作
- 理解宏语法为什么能在编译期成立

重点文件建议：

- `packages/compiler-sfc/src/parse.ts`
- `packages/compiler-sfc/src/compileScript.ts`
- `packages/compiler-sfc/src/compileTemplate.ts`
- `packages/compiler-sfc/src/compileStyle.ts`

核心问题：

- `.vue` 文件怎样解析成 descriptor？
- `script setup` 做了哪些编译期转换？
- 模板编译结果如何与脚本拼装？
- 样式作用域和选择器重写是怎么完成的？

阶段产出：

- 一张 SFC 编译全链路图
- 一份 `script setup` 编译前后对照笔记

### 6.8 第八阶段：高级运行时专题

目标：

- 在主链路读通后，再补增强能力
- 理解这些能力为什么必须挂在 runtime-core，而不是零散实现

建议专题：

- `KeepAlive`
- `Teleport`
- `Suspense`
- `Transition` / `TransitionGroup`
- 异步组件

这部分不要一开始就深挖，应该建立在前面已经理解 vnode、renderer、scheduler 的基础上。

阶段产出：

- 每个专题一页“解决的问题 / 核心状态 / 接入点”摘要

### 6.9 第九阶段：SSR 与 hydration

目标：

- 建立“服务端输出 HTML，客户端接管”的整体认知
- 理解 hydration 和纯客户端 mount 的差异
- 理解服务端渲染为什么会反过来约束部分运行时实现

重点文件建议：

- `packages/server-renderer/src/*`
- `runtime-core` / `runtime-dom` 中与 hydration 相关的分支

核心问题：

- SSR 输出和客户端 vnode 如何对齐？
- hydration 失败时会发生什么？
- 哪些能力天然更依赖 hydration 策略？

阶段产出：

- 一份 SSR / CSR / hydration 差异对照表

## 7. Vue 3.5 重点专题

这一部分不要只看旧教程，要单独建立“3.5 视角”。

建议做法：

1. 先看 Vue 3.5 对应版本的发布说明、变更记录、测试变更
2. 再按功能找到落地源码位置
3. 最后验证这些改动对日常开发意味着什么

建议重点关注：

- watcher 相关能力增强
- hydration / SSR 相关改进
- 模板 ref、组件暴露、编译宏相关调整
- 性能优化类改动背后的实现位置
- 类型支持和开发体验增强背后的编译期处理

阅读要求：

- 不只记录“新增了什么”
- 要记录“新增能力落在哪个 package”
- 要记录“是运行时改动、编译期改动，还是类型层改动”

阶段产出：

- 一份 Vue 3.5 重点改动表

建议表头如下：

| 主题 | 用户可见变化 | 源码位置 | 属于运行时/编译期/类型 | 你的理解 |
| --- | --- | --- | --- | --- |

## 8. 每周推进节奏

如果按 8 周节奏推进，建议这样安排：

### 第 1 周

- 跑通仓库
- 熟悉目录
- 建立首屏挂载主链路

### 第 2 周

- 读完 `reactivity`
- 补响应式最小实现

### 第 3 周

- 读 `runtime-core` 的 vnode、component、props、slots
- 画组件实例图

### 第 4 周

- 读 `scheduler`、`apiWatch`、`renderer`
- 搞清更新调度

### 第 5 周

- 读 `runtime-dom`
- 补 DOM patch 和事件系统笔记

### 第 6 周

- 读 `compiler-core`、`compiler-dom`
- 建立模板编译三段式认知

### 第 7 周

- 读 `compiler-sfc`
- 补 `script setup`、样式作用域、SFC 编译链路

### 第 8 周

- 集中处理 Vue 3.5 专题
- 回看 SSR / hydration
- 整理最终笔记体系

## 9. 每个阶段的固定检查项

每学完一个主题，至少检查下面五件事：

1. 能否用自己的话说清模块职责
2. 能否画出 5 到 10 个关键函数调用关系
3. 能否写一个最小 demo 复现这条链路
4. 能否找到相关测试并解释测试意图
5. 能否总结这个模块对上层 API 的实际价值

如果这五项做不到，通常说明还是停留在“看过”，还没进入“掌握”。

## 10. 推荐输出物

建议整个学习过程至少沉淀下面这些文档：

- `01-仓库结构与构建入口.md`
- `02-reactivity 核心机制.md`
- `03-组件实例与 vnode.md`
- `04-调度器与更新机制.md`
- `05-renderer 与 DOM patch.md`
- `06-编译器主流程.md`
- `07-SFC 编译链路.md`
- `08-SSR 与 hydration.md`
- `09-Vue 3.5 重点变化.md`

如果后续要继续深入，可以再补：

- `10-KeepAlive 与 Teleport.md`
- `11-Suspense 与异步组件.md`
- `12-watch 与副作用管理.md`

## 11. 常见误区

- 不要按文件顺序从头读到尾
- 不要只看源码不跑测试
- 不要只看文章不自己断点调试
- 不要把 Vue 3.2、3.3、3.4 的旧资料直接当成 3.5 结论
- 不要急着追求“全懂”，先打通主链路更重要

## 12. 小结

这份计划的核心不是“读完多少文件”，而是按 Vue 的真实执行路径建立认知：

- 先理解响应式如何产生变化
- 再理解运行时如何消费变化
- 再理解编译器如何减少运行时成本
- 最后回到 Vue 3.5 的具体新增与调整

建议阅读顺序：

1. `reactivity`
2. `runtime-core`
3. `runtime-dom`
4. `compiler-core`
5. `compiler-dom`
6. `compiler-sfc`
7. `server-renderer`
8. Vue 3.5 专题

如果这条主线能读通，后续再看 `KeepAlive`、`Teleport`、`Suspense`、宏编译、SSR 优化，就不会是碎片化吸收，而是建立在统一框架之上的扩展理解。
