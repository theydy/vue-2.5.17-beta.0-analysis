/* @flow */

import {
  warn,
  remove,
  isObject,
  parsePath,
  _Set as Set,
  handleError
} from '../util/index'

import { traverse } from './traverse'
import { queueWatcher } from './scheduler'
import Dep, { pushTarget, popTarget } from './dep'

import type { SimpleSet } from '../util/index'

let uid = 0

/**
 * A watcher parses an expression, collects dependencies,
 * and fires callback when the expression value changes.
 * This is used for both the $watch() api and directives.
 */
export default class Watcher {
  vm: Component;
  expression: string;
  cb: Function;
  id: number;
  deep: boolean;
  user: boolean;
  computed: boolean;
  sync: boolean;
  dirty: boolean;
  active: boolean;
  dep: Dep;
  deps: Array<Dep>;
  newDeps: Array<Dep>;
  depIds: SimpleSet;
  newDepIds: SimpleSet;
  before: ?Function;
  getter: Function;
  value: any;

  constructor (
    vm: Component,
    expOrFn: string | Function,
    cb: Function,
    options?: ?Object,
    isRenderWatcher?: boolean
  ) {
    /**
     * --=--
     * new Watcher 主要做如下三件事：
     * 1. 初始化配置
     * 2. 获取 getter
     * 3. 如果不是 computed watcher 立即执行 get
     */
    this.vm = vm
    if (isRenderWatcher) {
      vm._watcher = this
    }
    vm._watchers.push(this)
    // options
    if (options) {
      this.deep = !!options.deep
      this.user = !!options.user
      this.computed = !!options.computed
      this.sync = !!options.sync
      this.before = options.before
    } else {
      this.deep = this.user = this.computed = this.sync = false
    }
    this.cb = cb
    this.id = ++uid // uid for batching
    this.active = true
    this.dirty = this.computed // for computed watchers
    this.deps = []
    this.newDeps = []
    this.depIds = new Set()
    this.newDepIds = new Set()
    this.expression = process.env.NODE_ENV !== 'production'
      ? expOrFn.toString()
      : ''
    // parse expression for getter
    if (typeof expOrFn === 'function') {
      this.getter = expOrFn
    } else {
      /**
       * --=--
       * 一般来说 user watcher 才会进入这个分支逻辑。
       * $watch('obj.a', function () {})。
       * 监听 obj.a 这个属性。
       * 那么会执行 parsePath('obj.a') 去找对应的属性，触发 getter。
       */
      this.getter = parsePath(expOrFn)
      if (!this.getter) {
        this.getter = function () {}
        process.env.NODE_ENV !== 'production' && warn(
          `Failed watching path: "${expOrFn}" ` +
          'Watcher only accepts simple dot-delimited paths. ' +
          'For full control, use a function instead.',
          vm
        )
      }
    }
    if (this.computed) {
      this.value = undefined
      this.dep = new Dep()
    } else {
      this.value = this.get()
    }
  }

  /**
   * Evaluate the getter, and re-collect dependencies.
   */
  get () {
    /**
     * --=--
     * 1. 当前 Watcher 入栈
     * 2. getter()
     * 3. 当前 Watcher 出栈
     * 4. cleanupDeps 更新 deps
     */
    pushTarget(this)
    let value
    const vm = this.vm
    try {
      value = this.getter.call(vm, vm)
    } catch (e) {
      if (this.user) {
        handleError(e, vm, `getter for watcher "${this.expression}"`)
      } else {
        throw e
      }
    } finally {
      // "touch" every property so they are all tracked as
      // dependencies for deep watching
      if (this.deep) {
        traverse(value)
        /**
         * --=--
         * 深度监听时，递归遍历一遍 value 下的属性，
         * 触发 getter。
         */
      }
      popTarget()
      this.cleanupDeps()
    }
    return value
  }

  /**
   * Add a dependency to this directive.
   */
  addDep (dep: Dep) {
    const id = dep.id
    if (!this.newDepIds.has(id)) {
      this.newDepIds.add(id)
      this.newDeps.push(dep)
      if (!this.depIds.has(id)) {
        dep.addSub(this)
      }
    }
    /**
     * --=--
     * newDep* 是本次渲染中 watcher 订阅的 dep，
     * dep* 是上次渲染中该 watcher 订阅的 dep。
     * 在一次渲染过程结束后，newDep* 会被清空，而 dep* 保存本次 newDep* 的数据。
     * newDep* 和 dep* 都不存在一个 dep 时，才会执行 dep.addSub。
     * 如果 newDep* 没有这个 dep，但 dep* 中有这个 dep，说明这个 dep 在上次的渲染中
     * 就收集到这个 watcher 了，不需要重复 addSub(this)。
     */
  }

  /**
   * Clean up for dependency collection.
   */
  cleanupDeps () {
    let i = this.deps.length
    while (i--) {
      const dep = this.deps[i]
      if (!this.newDepIds.has(dep.id)) {
        dep.removeSub(this)
      }
      /**
       * --=--
       * 对某个 dep 来说，如果本次渲染中 newDep* 不存在，
       * 而 dep* 存在，说明该 watcher 原来订阅这个 dep，
       * 但是现在不再订阅了，所以需要从 dep 中删除该 watcher。
       * 比如 v-if 渲染的数据。
       */
    }
    let tmp = this.depIds
    this.depIds = this.newDepIds
    this.newDepIds = tmp
    this.newDepIds.clear()
    tmp = this.deps
    this.deps = this.newDeps
    this.newDeps = tmp
    this.newDeps.length = 0
    /**
     * --=--
     * newDep* 被清空，而 dep* 保存本次 newDep* 的数据。
     */
  }

  /**
   * Subscriber interface.
   * Will be called when a dependency changes.
   */
  update () {
    /**
     * --=--
     * computed watcher => this.getAndInvoke 重新计算并且触发 deps notify
     * .sync === true => this.run() 几乎等同于 this.getAndInvoke 并且触发 user watcher 回调
     * 其他 => queueWatcher(this) 将当前 Watcher 放入更新队列
     */
    /* istanbul ignore else */
    if (this.computed) {
      // A computed property watcher has two modes: lazy and activated.
      // It initializes as lazy by default, and only becomes activated when
      // it is depended on by at least one subscriber, which is typically
      // another computed property or a component's render function.
      if (this.dep.subs.length === 0) {
        // In lazy mode, we don't want to perform computations until necessary,
        // so we simply mark the watcher as dirty. The actual computation is
        // performed just-in-time in this.evaluate() when the computed property
        // is accessed.
        this.dirty = true
      } else {
        // In activated mode, we want to proactively perform the computation
        // but only notify our subscribers when the value has indeed changed.
        this.getAndInvoke(() => {
          this.dep.notify()
        })
        /**
         * --=--
         * computed 的 update 过程，getAndInvoke 会重新取一次 computed 的值，接着判断新旧值是否相等，如果不相等，则执行 () => { this.dep.notify() } 这个回调函数，派发更新，
         * 所以 computed 的 update 过程起到了这个 computed setter 函数的作用。
         * 而且计算属性是立即重新求值的，不是异步更新。
         * 当然订阅计算属性的 watcher 还是异步更新的。
         */
      }
    } else if (this.sync) {
      this.run()
    } else {
      queueWatcher(this)
      /**
       * --=--
       * 派发更新不会立即更新，而是将更新的 watcher 放入一个 queue 中，
       * 在 nexttick 中一起更新。
       */
    }
  }

  /**
   * Scheduler job interface.
   * Will be called by the scheduler.
   */
  run () {
    if (this.active) {
      this.getAndInvoke(this.cb)
    }
  }

  getAndInvoke (cb: Function) {
    const value = this.get()
    if (
      value !== this.value ||
      // Deep watchers and watchers on Object/Arrays should fire even
      // when the value is the same, because the value may
      // have mutated.
      isObject(value) ||
      this.deep
    ) {
      // set new value
      const oldValue = this.value
      this.value = value
      this.dirty = false
      if (this.user) {
        try {
          cb.call(this.vm, value, oldValue)
        } catch (e) {
          handleError(e, this.vm, `callback for watcher "${this.expression}"`)
        }
      } else {
        cb.call(this.vm, value, oldValue)
      }
    }
  }

  /**
   * Evaluate and return the value of the watcher.
   * This only gets called for computed property watchers.
   */
  evaluate () {
    /**
     * --=--
     * evaluate 函数在每一次 computed getter 触发时都会被调用，但是 computed 的值如果依赖不变，那么值就不会变，
     * 不需要 getter 一次就重新计算一次。
     * dirty 就是用来限制 computed 重新计算的，
     * dirty 只有在初始化时为 true，会立即取值一次，之后就会被置为 false，
     * 而且正常来说 dirty 之后是不可能改变再次置为 true 的，除非 computed 没有依赖响应式的数据。
     * evaluate 永远取得都是缓存的 value 值，
     * computed 的重新计算在 Watcher.update 中
     */
    if (this.dirty) {
      this.value = this.get()
      this.dirty = false
    }
    return this.value
  }

  /**
   * Depend on this watcher. Only for computed property watchers.
   */
  depend () {
    if (this.dep && Dep.target) {
      this.dep.depend()
    }
  }

  /**
   * Remove self from all dependencies' subscriber list.
   */
  teardown () {
    if (this.active) {
      // remove self from vm's watcher list
      // this is a somewhat expensive operation so we skip it
      // if the vm is being destroyed.
      if (!this.vm._isBeingDestroyed) {
        remove(this.vm._watchers, this)
      }
      let i = this.deps.length
      while (i--) {
        this.deps[i].removeSub(this)
      }
      this.active = false
    }
  }
}
