/* @flow */

import config from '../config'
import Watcher from '../observer/watcher'
import { pushTarget, popTarget } from '../observer/dep'
import { isUpdatingChildComponent } from './lifecycle'

import {
  set,
  del,
  observe,
  defineReactive,
  toggleObserving
} from '../observer/index'

import {
  warn,
  bind,
  noop,
  hasOwn,
  hyphenate,
  isReserved,
  handleError,
  nativeWatch,
  validateProp,
  isPlainObject,
  isServerRendering,
  isReservedAttribute
} from '../util/index'

const sharedPropertyDefinition = {
  enumerable: true,
  configurable: true,
  get: noop,
  set: noop
}

export function proxy (target: Object, sourceKey: string, key: string) {
  sharedPropertyDefinition.get = function proxyGetter () {
    return this[sourceKey][key]
  }
  sharedPropertyDefinition.set = function proxySetter (val) {
    this[sourceKey][key] = val
  }
  Object.defineProperty(target, key, sharedPropertyDefinition)
}

export function initState (vm: Component) {
  vm._watchers = []
  const opts = vm.$options
  if (opts.props) initProps(vm, opts.props)
  if (opts.methods) initMethods(vm, opts.methods)
  /**
   * --=--
   * methods 的处理很简单，只是判断了一下 method 类型，和 method 名是否被 props 和 vue 内部方法占用，
   * 如果都没有的话，就直接 vm[key] = opts.methods[key] 即可，并且 bind this 为 vm。
   */
  if (opts.data) {
    initData(vm)
  } else {
    observe(vm._data = {}, true /* asRootData */)
  }
  /**
   * --=--
   * data 的处理，根实例和子组件一些区别。
   * 判断有无 opts.data，有的话为子组件，执行 initData
   */
  if (opts.computed) initComputed(vm, opts.computed)
  if (opts.watch && opts.watch !== nativeWatch) {
    initWatch(vm, opts.watch)
  }
  /**
   * --=--
   * nativeWatch 是为了区分 Firefox 浏览器上 Object.prototype.watch 的原生方法。
   */
}

function initProps (vm: Component, propsOptions: Object) {
  /**
   * --=--
   * initProps 主要做了三件事
   * 1. props 校验和求值 (validateProp)
   * 2. props 响应式 (defineReactive)
   * 3. props 代理 (proxy)
   */
  const propsData = vm.$options.propsData || {}
  const props = vm._props = {}
  // cache prop keys so that future props updates can iterate using Array
  // instead of dynamic object key enumeration.
  const keys = vm.$options._propKeys = []
  const isRoot = !vm.$parent
  // root instance props should be converted
  if (!isRoot) {
    toggleObserving(false)
  }
  for (const key in propsOptions) {
    keys.push(key)
    const value = validateProp(key, propsOptions, propsData, vm)
    /* istanbul ignore else */
    if (process.env.NODE_ENV !== 'production') {
      const hyphenatedKey = hyphenate(key)
      if (isReservedAttribute(hyphenatedKey) ||
          config.isReservedAttr(hyphenatedKey)) {
        warn(
          `"${hyphenatedKey}" is a reserved attribute and cannot be used as component prop.`,
          vm
        )
      }
      defineReactive(props, key, value, () => {
        if (vm.$parent && !isUpdatingChildComponent) {
          warn(
            `Avoid mutating a prop directly since the value will be ` +
            `overwritten whenever the parent component re-renders. ` +
            `Instead, use a data or computed property based on the prop's ` +
            `value. Prop being mutated: "${key}"`,
            vm
          )
        }
      })
    } else {
      defineReactive(props, key, value)
    }
    // static props are already proxied on the component's prototype
    // during Vue.extend(). We only need to proxy props defined at
    // instantiation here.
    if (!(key in vm)) {
      proxy(vm, `_props`, key)
    }
  }
  toggleObserving(true)
}

function initData (vm: Component) {
  /**
   * --=--
   * initData 主要做了四件事情：类型判断取值、命名冲突判断、proxy 代理、observe(data) 响应式。
   */
  let data = vm.$options.data
  data = vm._data = typeof data === 'function'
    ? getData(data, vm)
    : data || {}
  /**
   * --=--
   * 因为 data 可以写成 function () { return { a: 1, b: 2} } 或者直接是 { a: 1, b: 2}
   * 所以取值前，需要判断类型，对于函数的情况，会调用 getData 方法取值。
   */
  if (!isPlainObject(data)) {
    data = {}
    process.env.NODE_ENV !== 'production' && warn(
      'data functions should return an object:\n' +
      'https://vuejs.org/v2/guide/components.html#data-Must-Be-a-Function',
      vm
    )
  }
  /**
   * --=--
   * data 合并策略最后返回的是一个函数，然后在 initData 中通过调用这个函数获得真正的数据。
   */
  // proxy data on instance
  const keys = Object.keys(data)
  const props = vm.$options.props
  const methods = vm.$options.methods
  let i = keys.length
  while (i--) {
    const key = keys[i]
    if (process.env.NODE_ENV !== 'production') {
      if (methods && hasOwn(methods, key)) {
        warn(
          `Method "${key}" has already been defined as a data property.`,
          vm
        )
      }
    }
    if (props && hasOwn(props, key)) {
      process.env.NODE_ENV !== 'production' && warn(
        `The data property "${key}" is already declared as a prop. ` +
        `Use prop default value instead.`,
        vm
      )
    } else if (!isReserved(key)) {
      proxy(vm, `_data`, key)
    }
  }
  /**
   * --=--
   * data 中属性命名和 props, methods 比较是否有重复的。
   */
  // observe data
  observe(data, true /* asRootData */)
  /**
   * --=--
   * 观测 data 数据。
   */
}

export function getData (data: Function, vm: Component): any {
  /**
   * --=--
   * 执行 data 函数获取最终的结果前后，有个 pushTarget popTarget 操作，并且没有传 watcher
   * 这里是针对 https://github.com/vuejs/vue/issues/7573 的一个修改
   *
   * 如果子组件 data 是一个函数并且函数中使用了 props，此时 props 已经是一个响应式数据，
   * 此时会触发 props 的 getter，造成 props 收集依赖，
   * 由于数据初始化的时机是 beforeCreated -> created 之间，此时还没有进入子组件的渲染阶段，
   * Dep.target 还是父组件的渲染 Watcher，导致 props 收集到了父组件的渲染 Watcher，
   * 最终表现就是父组件的字段更新时，触发了一次 update，更新子组件的 props 时第二次触发 update。
   * 
   * 更新一次后，这个 bug 就不会出现了，因为更新后再次收集依赖时子组件的渲染 Watcher 已经存在。
   */
  // #7573 disable dep collection when invoking data getters
  pushTarget()
  try {
    return data.call(vm, vm)
  } catch (e) {
    handleError(e, vm, `data()`)
    return {}
  } finally {
    popTarget()
  }
}

const computedWatcherOptions = { computed: true }

function initComputed (vm: Component, computed: Object) {
  /**
   * --=--
   * initComputed 的流程大致如下：
   * 1. 在 vm 实例上创建 _computedWatchers，_computedWatchers 存放的是这个 vm 实例中所有的 computed watcher
   * 2. computed 类型判断取值，computed 存在函数写法和配置写法两种。
   * 3. 在 _computedWatchers[key] 上创建对应的 computed watcher
   * 4. defineComputed
   */
  // $flow-disable-line
  const watchers = vm._computedWatchers = Object.create(null)
  // computed properties are just getters during SSR
  const isSSR = isServerRendering()

  for (const key in computed) {
    const userDef = computed[key]
    const getter = typeof userDef === 'function' ? userDef : userDef.get
    /**
     * --=--
     * computed 可以写成一个函数或是一个对象 { get () {} }
     */
    if (process.env.NODE_ENV !== 'production' && getter == null) {
      warn(
        `Getter is missing for computed property "${key}".`,
        vm
      )
    }

    if (!isSSR) {
      // create internal watcher for the computed property.
      watchers[key] = new Watcher(
        vm,
        getter || noop,
        noop,
        computedWatcherOptions
      )
    }

    // component-defined computed properties are already defined on the
    // component prototype. We only need to define computed properties defined
    // at instantiation here.
    /**
     * --=--
     * 组件定义的计算属性已经定义在组件的原型对象上了，所以这里只需要定义在实例化时定义的计算属性。
     * 在生成组件构造函数 Vue.extend 中有一句：
     * if (Sub.options.computed) {
     *   initComputed(Sub)
     * }
     * function initComputed (Comp) {
     *   const computed = Comp.options.computed
     *   for (const key in computed) {
     *     defineComputed(Comp.prototype, key, computed[key])
     *   }
     * }
     * 可以发现确实组件的计算属性早就定义在组件的原型对象上了，之所以这样做，
     * 是为了避免每次 new 一个组件实例就重复做一次计算属性的定义，对于 props 同样是这样做的。
     */
    if (!(key in vm)) {
      defineComputed(vm, key, userDef)
      /**
       * --=--
       * 子组件的computed 是在 Vue.extend 中定义的，根组件会走进这个分支
       */
    } else if (process.env.NODE_ENV !== 'production') {
      if (key in vm.$data) {
        warn(`The computed property "${key}" is already defined in data.`, vm)
      } else if (vm.$options.props && key in vm.$options.props) {
        warn(`The computed property "${key}" is already defined as a prop.`, vm)
      }
    }
  }
}

export function defineComputed (
  target: any,
  key: string,
  userDef: Object | Function
) {
  const shouldCache = !isServerRendering()
  if (typeof userDef === 'function') {
    sharedPropertyDefinition.get = shouldCache
      ? createComputedGetter(key)
      : userDef
    sharedPropertyDefinition.set = noop
  } else {
    sharedPropertyDefinition.get = userDef.get
      ? shouldCache && userDef.cache !== false
        ? createComputedGetter(key)
        : userDef.get
      : noop
    sharedPropertyDefinition.set = userDef.set
      ? userDef.set
      : noop
  }
  if (process.env.NODE_ENV !== 'production' &&
      sharedPropertyDefinition.set === noop) {
    sharedPropertyDefinition.set = function () {
      warn(
        `Computed property "${key}" was assigned to but it has no setter.`,
        this
      )
    }
  }
  Object.defineProperty(target, key, sharedPropertyDefinition)
  /**
   * --=--
   * defineComputed 函数其实就是给 vm[computedKey] 设置对应的 getter、setter
   * 其中 getter 是根据 createComputedGetter 函数得来的。
   */
}

function createComputedGetter (key) {
  return function computedGetter () {
    const watcher = this._computedWatchers && this._computedWatchers[key]
    if (watcher) {
      watcher.depend()
      return watcher.evaluate()
      /**
       * --=--
       * computed 的 getter 函数做的第一件事就是收集依赖，
       * computed watcher 构造函数在 watcher 内会创建一个 dep 对象，
       * watcher.depend 这个方法也是专门用于 computed watcher 使用的，
       * 用于让 computed watcher 的 dep 收集到当前计算中的 watcher。
       * 第二件事是返回 computed 正确的计算值。
       * watcher.evaluate 这个方法也是 computed watcher 的专用方法，
       * 作用是通过 watcher.dirty 评估是否需要重新计算 computed 值，如果需要就执行 computed
       * 的计算并返回新值，否则返回旧值，computed 第一次求值就是在 getter 被访问后执行的。
       */
    }
  }
}

function initMethods (vm: Component, methods: Object) {
  const props = vm.$options.props
  for (const key in methods) {
    if (process.env.NODE_ENV !== 'production') {
      if (methods[key] == null) {
        warn(
          `Method "${key}" has an undefined value in the component definition. ` +
          `Did you reference the function correctly?`,
          vm
        )
      }
      if (props && hasOwn(props, key)) {
        warn(
          `Method "${key}" has already been defined as a prop.`,
          vm
        )
      }
      if ((key in vm) && isReserved(key)) {
        warn(
          `Method "${key}" conflicts with an existing Vue instance method. ` +
          `Avoid defining component methods that start with _ or $.`
        )
      }
    }
    vm[key] = methods[key] == null ? noop : bind(methods[key], vm)
  }
}

function initWatch (vm: Component, watch: Object) {
  /**
   * --=--
   * initWatch 做的事情就是遍历 watch 下的属性，执行 createWatcher，
   * 因为 watch 同一个属性可以执行多个处理函数，所以 handle 可以是一个数组，
   * 那么这时就多了一层遍历。
   */
  for (const key in watch) {
    const handler = watch[key]
    if (Array.isArray(handler)) {
      for (let i = 0; i < handler.length; i++) {
        createWatcher(vm, key, handler[i])
      }
    } else {
      createWatcher(vm, key, handler)
    }
  }
}

function createWatcher (
  vm: Component,
  expOrFn: string | Function,
  handler: any,
  options?: Object
) {
  if (isPlainObject(handler)) {
    options = handler
    handler = handler.handler
    /**
     * --=--
     * 对象写法：
     * {
     *   handler () {},
     *   sync,
     *   deep,
     *   immediate
     * }
     */
  }
  if (typeof handler === 'string') {
    handler = vm[handler]
    /**
     * --=--
     * 也可以是一个字符串，这个字符串是定义在 methods 里的函数名
     */
  }
  return vm.$watch(expOrFn, handler, options)
}

export function stateMixin (Vue: Class<Component>) {
  // flow somehow has problems with directly declared definition object
  // when using Object.defineProperty, so we have to procedurally build up
  // the object here.
  const dataDef = {}
  dataDef.get = function () { return this._data }
  const propsDef = {}
  propsDef.get = function () { return this._props }
  if (process.env.NODE_ENV !== 'production') {
    dataDef.set = function (newData: Object) {
      warn(
        'Avoid replacing instance root $data. ' +
        'Use nested data properties instead.',
        this
      )
    }
    propsDef.set = function () {
      warn(`$props is readonly.`, this)
    }
  }
  Object.defineProperty(Vue.prototype, '$data', dataDef)
  Object.defineProperty(Vue.prototype, '$props', propsDef)

  Vue.prototype.$set = set
  Vue.prototype.$delete = del

  Vue.prototype.$watch = function (
    expOrFn: string | Function,
    cb: any,
    options?: Object
  ): Function {
    const vm: Component = this
    if (isPlainObject(cb)) {
      /**
       * --=--
       * 因为 $watch 这个接口对外是开放的，所以 cb 可能并不符合格式，
       * 这里又做了一次 createWatcher，
       * 不过从这里可以发现，当我们使用 $watch 这个接口定义 user watcher 时，
       * 支持的写法比起 options.watch 的方式少了很多，
       * option.watch 支持的格式有：函数，数组，对象，字符串。
       * $watch 支持的格式有：函数，对象。
       * 不支持数组的写法是因为 $watch 最后会返回销毁这个 watcher 的函数，
       * 不过为啥不支持字符串涅
       * if (typeof cb === 'string' || isPlainObject(cb)) {
       *   return createWatcher(vm, expOrFn, cb, options)
       * }
       */
      return createWatcher(vm, expOrFn, cb, options)
    }
    options = options || {}
    options.user = true
    const watcher = new Watcher(vm, expOrFn, cb, options)
    /**
     * --=--
     * 用 $watch 不能监听不是响应式的属性。
     * 因为 $watch 原理还是使用 Watchr 类，当访问对应属性时，
     * 触发 getter 收集依赖，更新属性时，派发更新。
     */
    if (options.immediate) {
      cb.call(vm, watcher.value)
    }
    return function unwatchFn () {
      watcher.teardown()
    }
  }
}
