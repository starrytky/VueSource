import {
  type Target,
  isReadonly,
  isShallow,
  reactive,
  reactiveMap,
  readonly,
  readonlyMap,
  shallowReactiveMap,
  shallowReadonlyMap,
  toRaw,
} from './reactive'
import { arrayInstrumentations } from './arrayInstrumentations'
import { ReactiveFlags, TrackOpTypes, TriggerOpTypes } from './constants'
import { ITERATE_KEY, track, trigger } from './dep'
import {
  hasChanged,
  hasOwn,
  isArray,
  isIntegerKey,
  isObject,
  isSymbol,
  makeMap,
} from '@vue/shared'
import { isRef } from './ref'
import { warn } from './warning'

const isNonTrackableKeys = /*@__PURE__*/ makeMap(`__proto__,__v_isRef,__isVue`)

const builtInSymbols = new Set(
  /*@__PURE__*/
  Object.getOwnPropertyNames(Symbol)
    // ios10.x Object.getOwnPropertyNames(Symbol) can enumerate 'arguments' and 'caller'
    // but accessing them on Symbol leads to TypeError because Symbol is a strict mode
    // function
    .filter(key => key !== 'arguments' && key !== 'caller')
    .map(key => Symbol[key as keyof SymbolConstructor])
    .filter(isSymbol),
)

function hasOwnProperty(this: object, key: unknown) {
  // #10455 hasOwnProperty may be called with non-string values
  if (!isSymbol(key)) key = String(key)
  const obj = toRaw(this)
  track(obj, TrackOpTypes.HAS, key)
  return obj.hasOwnProperty(key as string)
}

class BaseReactiveHandler implements ProxyHandler<Target> {
  // `_isReadonly` / `_isShallow` 由子类在构造时传入，用来复用同一套 `get`
  // 拦截逻辑：
  // - mutable:     既会 track，也会把嵌套对象继续包装成 reactive
  // - readonly:    不会 track，嵌套对象继续包装成 readonly
  // - shallow:     只处理当前这一层，不继续深层代理，也不深层解包 ref
  constructor(
    protected readonly _isReadonly = false,
    protected readonly _isShallow = false,
  ) { }

  get(target: Target, key: string | symbol, receiver: object): any {
    // `__v_skip` 这类内部标记直接透传。
    // 这一步不参与依赖收集，只是让运行时能识别“这个对象不要再被代理”。
    if (key === ReactiveFlags.SKIP) return target[ReactiveFlags.SKIP]

    const isReadonly = this._isReadonly,
      isShallow = this._isShallow

    // 访问这些内部 flag 时，不是读取用户状态，而是在询问“当前代理是什么类型”。
    // 因此这里只返回布尔信息，不做 track。
    if (key === ReactiveFlags.IS_REACTIVE) {
      return !isReadonly
    } else if (key === ReactiveFlags.IS_READONLY) {
      return isReadonly
    } else if (key === ReactiveFlags.IS_SHALLOW) {
      return isShallow
    } else if (key === ReactiveFlags.RAW) {
      // 只有“当前 receiver 的确是这个 target 对应的代理”时，才允许拿到底层原始对象。
      // 这样可以避免用户伪造访问路径，绕过代理层直接读 raw。
      //
      // 第二个分支处理的是“用户又包了一层自定义 proxy”的情况：
      // 只要原型链一致，也认为这是同一个响应式代理的合法接收者。
      if (
        receiver ===
        (isReadonly
          ? isShallow
            ? shallowReadonlyMap
            : readonlyMap
          : isShallow
            ? shallowReactiveMap
            : reactiveMap
        ).get(target) ||
        // receiver is not the reactive proxy, but has the same prototype
        // this means the receiver is a user proxy of the reactive proxy
        Object.getPrototypeOf(target) === Object.getPrototypeOf(receiver)
      ) {
        return target
      }
      // early return undefined
      return
    }

    const targetIsArray = isArray(target)

    if (!isReadonly) {
      let fn: Function | undefined
      // 数组上的某些方法会被特殊改写，例如：
      // - 需要屏蔽内部额外的依赖收集
      // - 需要修正 `includes/indexOf/push` 等方法在响应式场景下的行为
      // 命中这些方法时，直接返回 instrumented 版本。
      if (targetIsArray && (fn = arrayInstrumentations[key])) {
        return fn
      }
      // `obj.hasOwnProperty(x)` 也要参与依赖收集，所以返回自定义实现。
      if (key === 'hasOwnProperty') {
        return hasOwnProperty
      }
    }

    // 真正执行属性读取。
    // 对 ref 本体使用 raw ref 作为 receiver，是为了保证 ref 类方法里的 `this`
    // 指向原始 ref，而不是外层 proxy，减少内部反复 `toRaw` 的成本。
    const res = Reflect.get(
      target,
      key,
      // if this is a proxy wrapping a ref, return methods using the raw ref
      // as receiver so that we don't have to call `toRaw` on the ref in all
      // its class methods
      isRef(target) ? target : receiver,
    )

    // 内建 symbol（如 `Symbol.iterator`）和少量内部 key 不参与依赖收集。
    // 否则一次普通对象访问，可能意外把运行时内部行为也收集进去。
    if (isSymbol(key) ? builtInSymbols.has(key) : isNonTrackableKeys(key)) {
      return res
    }

    if (!isReadonly) {
      // 普通 `get` 才会建立 “target.key -> activeEffect” 的依赖关系。
      // readonly 读取不需要在后续变更时重新触发，因此不 track。
      track(target, TrackOpTypes.GET, key)
    }

    if (isShallow) {
      // shallow 模式到这里就结束：
      // - 不继续把嵌套对象包装成 reactive/readonly
      // - 不自动解包嵌套 ref
      return res
    }

    if (isRef(res)) {
      // 深层响应式下会自动解包 ref：
      // `state.count` 返回的是 `count.value`，不是 ref 对象本身。
      //
      // 但数组的整数索引是例外：
      // `arr[0]` 需要保留 ref 本体，否则会破坏数组中存 ref 的语义，
      // 也会让赋值和身份判断变得混乱。
      const value = targetIsArray && isIntegerKey(key) ? res : res.value
      // 如果当前是 readonly，并且解包后得到的是对象，
      // 这里还要继续包成 readonly，保证只读语义能向下传递。
      return isReadonly && isObject(value) ? readonly(value) : value
    }

    if (isObject(res)) {
      // 懒代理：
      // 只有真正读到某个嵌套对象时，才把它包装成 reactive/readonly。
      // 这样避免初始化时递归遍历整个对象树，也规避循环引用带来的开销。
      //
      // 这里先判断 `isObject`，是为了避免对原始值做无意义包装。
      // 同时 `reactive/readonly` 放在这里再调用，可以避开模块循环依赖问题。
      return isReadonly ? readonly(res) : reactive(res)
    }

    // 原始值直接返回。
    return res
  }
}

class MutableReactiveHandler extends BaseReactiveHandler {
  // 可变代理复用 BaseReactiveHandler 的 `get` 逻辑，
  // 这里只补写操作与结构查询相关的拦截：
  // - `set`            负责区分新增 / 修改，并触发对应类型的更新
  // - `deleteProperty` 负责删除属性后的触发
  // - `has`            让 `key in obj` 这类访问建立依赖
  // - `ownKeys`        让 `for...in / Object.keys` 这类遍历建立依赖
  constructor(isShallow = false) {
    super(false, isShallow)
  }

  set(
    target: Record<string | symbol, unknown>,
    key: string | symbol,
    value: unknown,
    receiver: object,
  ): boolean {
    debugger;
    // 先取旧值，后面需要用它来判断：
    // 1. 这是新增属性还是修改已有属性
    // 2. 新旧值是否真的发生变化
    // 3. 是否命中了“旧值是 ref，新值不是 ref”的特殊赋值路径
    let oldValue = target[key]
    // 数组索引赋值要单独对待：
    // `arr[1] = x` 既可能是修改已有项，也可能是向尾部新增元素。
    // 这里提前记下“当前是不是数组整数索引”。
    const isArrayWithIntegerKey = isArray(target) && isIntegerKey(key)
    if (!this._isShallow) {
      // 深层响应式下，赋值前会尽量把两边都转成 raw 再比较/写入，
      // 避免拿 proxy 和 raw 混着比较，导致“看起来变了，其实没变”。
      const isOldValueReadonly = isReadonly(oldValue)
      if (!isShallow(value) && !isReadonly(value)) {
        oldValue = toRaw(oldValue)
        value = toRaw(value)
      }
      // 这个分支是 Vue 一个很重要的“ref 透传赋值”优化：
      //
      // 例子：
      // `state.count = ref(1)`
      // 之后执行 `state.count = 2`
      //
      // 对用户直觉来说，这更像是“改 ref.value”，而不是“把整个 ref 替换掉”。
      // 所以当旧值是 ref、新值不是 ref，并且当前不是数组索引时，
      // Vue 会转成 `oldValue.value = value`，保留原 ref 身份不变。
      //
      // 数组索引不走这个分支，因为数组里存 ref 往往就是想保留 ref 本体。
      if (!isArrayWithIntegerKey && isRef(oldValue) && !isRef(value)) {
        if (isOldValueReadonly) {
          // 旧 ref 本身如果是 readonly ref，就不能透传写入，只能警告并吞掉这次 set。
          if (__DEV__) {
            warn(
              `Set operation on key "${String(key)}" failed: target is readonly.`,
              target[key],
            )
          }
          return true
        } else {
          oldValue.value = value
          return true
        }
      }
    } else {
      // shallow 模式不会深拆值：
      // 传进来是对象就原样放进去，不会先转 raw，也不会递归处理内部结构。
    }

    // 判断这次赋值在语义上是“新增”还是“修改”：
    // - 数组看索引是否落在当前 length 以内
    // - 普通对象看 key 是否本来就存在
    const hadKey = isArrayWithIntegerKey
      ? Number(key) < target.length
      : hasOwn(target, key)
    // 交给原生 `Reflect.set` 执行实际写入。
    //
    // 对 ref 本体仍然使用 raw ref 作为 receiver，
    // 原因和 `get` 里一致：让内部类方法里的 `this` 指向真实 ref。
    const result = Reflect.set(
      target,
      key,
      value,
      isRef(target) ? target : receiver,
    )
    // 只在“本次 set 真正落到了当前 target 自己身上”时才触发响应。
    //
    // 这是为了防止原型链场景重复触发。
    // 例如访问的是子对象代理，但实际 set 命中了原型上的 setter，
    // 这时 receiver 和 target 关系会变复杂，不能简单认为当前 target 应该触发更新。
    if (target === toRaw(receiver)) {
      if (!hadKey) {
        // 新增属性：对应 ADD
        trigger(target, TriggerOpTypes.ADD, key, value)
      } else if (hasChanged(value, oldValue)) {
        // 已有属性且值真的变化：对应 SET
        // 如果新旧值相同，则不触发，避免无意义更新。
        trigger(target, TriggerOpTypes.SET, key, value, oldValue)
      }
    }
    debugger;
    return result
  }

  deleteProperty(
    target: Record<string | symbol, unknown>,
    key: string | symbol,
  ): boolean {
    debugger;
    // 删除前先记录“这个 key 原来是否存在”以及旧值。
    // 只有真的删掉了一个原本存在的属性，才需要触发依赖。
    const hadKey = hasOwn(target, key)
    const oldValue = target[key]
    const result = Reflect.deleteProperty(target, key)
    if (result && hadKey) {
      // 删除属性会影响：
      // - 直接读取该 key 的 effect
      // - `in` 判断
      // - 对象/数组的遍历类依赖
      trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
    }
    debugger;
    return result
  }

  has(target: Record<string | symbol, unknown>, key: string | symbol): boolean {
    // 代理 `key in obj`。
    // 这种访问虽然不是取值，但它依赖“这个 key 是否存在”的结构信息，
    // 所以也要建立依赖，后续 ADD / DELETE 时才能重新执行。
    const result = Reflect.has(target, key)
    if (!isSymbol(key) || !builtInSymbols.has(key)) {
      track(target, TrackOpTypes.HAS, key)
    }
    return result
  }

  ownKeys(target: Record<string | symbol, unknown>): (string | symbol)[] {
    // 代理遍历类操作，例如：
    // - `for (const k in obj)`
    // - `Object.keys(obj)`
    // - `Object.getOwnPropertyNames(obj)`
    //
    // 这类 effect 依赖的不是某个具体 key 的值，而是“可枚举键集合”。
    // 因此这里收集的是 ITERATE 依赖。
    //
    // 数组遍历的核心结构信息是 `length`，所以数组用 `length` 作为依赖 key；
    // 普通对象则统一用 `ITERATE_KEY` 表示“键集合发生变化”。
    track(
      target,
      TrackOpTypes.ITERATE,
      isArray(target) ? 'length' : ITERATE_KEY,
    )
    return Reflect.ownKeys(target)
  }
}

class ReadonlyReactiveHandler extends BaseReactiveHandler {
  constructor(isShallow = false) {
    super(true, isShallow)
  }

  set(target: object, key: string | symbol) {
    if (__DEV__) {
      warn(
        `Set operation on key "${String(key)}" failed: target is readonly.`,
        target,
      )
    }
    return true
  }

  deleteProperty(target: object, key: string | symbol) {
    if (__DEV__) {
      warn(
        `Delete operation on key "${String(key)}" failed: target is readonly.`,
        target,
      )
    }
    return true
  }
}

export const mutableHandlers: ProxyHandler<object> =
  /*@__PURE__*/ new MutableReactiveHandler()

export const readonlyHandlers: ProxyHandler<object> =
  /*@__PURE__*/ new ReadonlyReactiveHandler()

export const shallowReactiveHandlers: MutableReactiveHandler =
  /*@__PURE__*/ new MutableReactiveHandler(true)

// Props handlers are special in the sense that it should not unwrap top-level
// refs (in order to allow refs to be explicitly passed down), but should
// retain the reactivity of the normal readonly object.
export const shallowReadonlyHandlers: ReadonlyReactiveHandler =
  /*@__PURE__*/ new ReadonlyReactiveHandler(true)
