/* @flow */

import Dep from './dep'
import VNode from '../vdom/vnode'
import { arrayMethods } from './array'
import {
  def,
  warn,
  hasOwn,
  hasProto,
  isObject,
  isPlainObject,
  isPrimitive,
  isUndef,
  isValidArrayIndex,
  isServerRendering
} from '../util/index'

const arrayKeys = Object.getOwnPropertyNames(arrayMethods)

/**
 * In some cases we may want to disable observation inside a component's
 * update computation.
 */
export let shouldObserve: boolean = true

export function toggleObserving (value: boolean) {
  shouldObserve = value
}

/**
 * Observer class that is attached to each observed
 * object. Once attached, the observer converts the target
 * object's property keys into getter/setters that
 * collect dependencies and dispatch updates.
 */
export class Observer {
  value: any;
  dep: Dep;
  vmCount: number; // number of vms that has this object as root $data

  constructor (value: any) {
    this.value = value
    this.dep = new Dep()
    this.vmCount = 0
    def(value, '__ob__', this)
    if (Array.isArray(value)) {
      const augment = hasProto
        ? protoAugment
        : copyAugment
      augment(value, arrayMethods, arrayKeys)
      this.observeArray(value)
    } else {
      this.walk(value)
    }
  }

  /**
   * Walk through each property and convert them into
   * getter/setters. This method should only be called when
   * value type is Object.
   */
  walk (obj: Object) {
    const keys = Object.keys(obj)
    for (let i = 0; i < keys.length; i++) {
      defineReactive(obj, keys[i])
    }
  }

  /**
   * Observe a list of Array items.
   */
  observeArray (items: Array<any>) {
    for (let i = 0, l = items.length; i < l; i++) {
      observe(items[i])
    }
  }
}

// helpers

/**
 * Augment an target Object or Array by intercepting
 * the prototype chain using __proto__
 */
function protoAugment (target, src: Object, keys: any) {
  /* eslint-disable no-proto */
  target.__proto__ = src
  /* eslint-enable no-proto */
}

/**
 * Augment an target Object or Array by defining
 * hidden properties.
 */
/* istanbul ignore next */
function copyAugment (target: Object, src: Object, keys: Array<string>) {
  for (let i = 0, l = keys.length; i < l; i++) {
    const key = keys[i]
    def(target, key, src[key])
  }
}

/**
 * Attempt to create an observer instance for a value,
 * returns the new observer if successfully observed,
 * or the existing observer if the value already has one.
 */
export function observe (value: any, asRootData: ?boolean): Observer | void {
  if (!isObject(value) || value instanceof VNode) {
    return
  }
  let ob: Observer | void
  if (hasOwn(value, '__ob__') && value.__ob__ instanceof Observer) {
    ob = value.__ob__
  } else if (
    shouldObserve &&
    !isServerRendering() &&
    (Array.isArray(value) || isPlainObject(value)) &&
    Object.isExtensible(value) &&
    !value._isVue
    /**
     * --=--
     * Vue 实例 ._isVue 为 true。
     */
  ) {
    ob = new Observer(value)
  }
  if (asRootData && ob) {
    ob.vmCount++
    /**
     * --=--
     * 对于 Vue 实例 data 的 ob.vmCount = 1，而对于 data 属性的递归观测的 ob.vmCount = 0，
     * 就是说 ob.vmCount == 1 可以判断出这个 __ob__ 是在 vm.$options.data 上的属性。
     */
  }
  return ob
}

/**
 * Define a reactive property on an Object.
 */
export function defineReactive (
  obj: Object,
  key: string,
  val: any,
  customSetter?: ?Function,
  shallow?: boolean
) {
  /**
   * --=--
   * defineReactive 函数的核心是将数据对象的数据属性转换为访问器属性
   */
  const dep = new Dep()

  const property = Object.getOwnPropertyDescriptor(obj, key)
  if (property && property.configurable === false) {
    return
  }

  // cater for pre-defined getter/setters
  const getter = property && property.get
  const setter = property && property.set
  if ((!getter || setter) && arguments.length === 2) {
    val = obj[key]
  }

  let childOb = !shallow && observe(val)
  /**
   * --=--
   * 如果值 val 还是一个对象或数组，那么会递归观测得到 childOb = val.__ob__
   */
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    get: function reactiveGetter () {
      const value = getter ? getter.call(obj) : val
      if (Dep.target) {
        dep.depend()
        /**
         * --=--
         * 收集依赖
         */
        if (childOb) {
          childOb.dep.depend()
          if (Array.isArray(value)) {
            dependArray(value)
            /**
             * --=--
             * dependArray 实际上是遍历了 Array 做了依赖收集的操作，
             * 并且如果 Array 的属性还是 Array，那么需要递归调用 dependArray，
             * 之所以会这样，是因为 Object.defineProperty 只针对 Object 才会设置 getter, setter。
             * 而在 template 中使用了数组的话，除非这个数组是一个 Object 的直接的属性，才会正常收集依赖。
             * 而 array[0] 这样操作只触发了 array 的 getter，而没有触发 array[0] 这一层的 getter
             * 这会造成当修改 array[0] 触发更新时，并没有对应的 watcher 更新。
             * 所以遍历 Array + 递归调用 dependArray 手动收集依赖，
             * 当然这里会造成假如 template 中没有用到 array[1]，但是修改了 array[1] 后会重新渲染视图，
             * 因为 dependArray 使得 array 下的所有属性都收集了当前的 watcher 。
             * Object 不用递归是因为 data.a.b 这样访问，data, data.a, data.a.b 每一层的 getter 都会被调用到。
             * by the way，在 template 中直接写一个 obj，那么实际上 render 是会调用 JSON.stringify(obj) 的。
             * 而 JSON.stringify 就会访问 obj 下的所有属性触发 getter。
             */
          }
        }
        /**
         * --=--
         * 这一段逻辑是为了在 Vue.$set 或 Vue.$delete 正确的触发更新。
         * 实际上对于一个对象的响应式属性，收集的依赖有两份，
         * 一份是 defineReactive 开头创建的 dep，
         * 还有一份就是 childOb.dep，这是在 new Observer 中创建的，
         * childOb.dep === val.__ob__.dep。
         * 这两份依赖触发更新的时机不同。
         * dep 触发更新的时机就是 setter 中，
         * 而 childOb.dep 触发更新的时机在 Vue.$set 方法中，
         * 因为 Vue 使用 Object.defineProperty 没有办法监听
         * 到给对象添加新属性的情况，但是添加新属性肯定是 setter 的一种，
         * 所以这时候需要手动执行 dep 的 notify，
         * 这种情况下就可以通过 obj.__ob__.dep 来取到这个 obj 相同的一份依赖了。
         * 而且对于数组来说只有 obj.__ob__.dep 这一份 dep，
         * 想要修改数组并且派发更新也只能通过 Vue.$set 来做，Vue.$set 的原理就是调用了数组的变异方法，
         * 而我们改写了数组的变异方法，在变异方法中派发了更新。
         */
      }
      return value
    },
    set: function reactiveSetter (newVal) {
      const value = getter ? getter.call(obj) : val
      /* eslint-disable no-self-compare */
      if (newVal === value || (newVal !== newVal && value !== value)) {
        return
      }
      /* eslint-enable no-self-compare */
      if (process.env.NODE_ENV !== 'production' && customSetter) {
        customSetter()
      }
      if (setter) {
        setter.call(obj, newVal)
      } else {
        val = newVal
      }
      childOb = !shallow && observe(newVal)
      /**
       * --=--
       * newVal 可能是一个对象或数组，所以要观测 newVal
       */
      dep.notify()
      /**
       * --=--
       * 派发更新
       */
    }
  })
}

/**
 * Set a property on an object. Adds the new property and
 * triggers change notification if the property doesn't
 * already exist.
 */
export function set (target: Array<any> | Object, key: any, val: any): any {
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(`Cannot set reactive property on undefined, null, or primitive value: ${(target: any)}`)
  }
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.length = Math.max(target.length, key)
    target.splice(key, 1, val)
    return val
    /**
     * --=--
     * 对于正常的数组来说，必定是走进这里调用 splice 变异方法来处理的。
     * 除非 key 不是一个非负整数，
     * 作为一个非法的 key，会作为一个数组的自定义属性来处理，走和 Object 新增属性相同的逻辑。
     */
  }
  if (key in target && !(key in Object.prototype)) {
    target[key] = val
    return val
  }
  /**
   * --=--
   * 以下的逻辑正常来说只针对新增的 Object 属性。
   */
  const ob = (target: any).__ob__
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid adding reactive properties to a Vue instance or its root $data ' +
      'at runtime - declare it upfront in the data option.'
    )
    return val
  }
  if (!ob) {
    target[key] = val
    return val
    /**
     * --=--
     * 如果不是一个响应式的对象，那么直接赋值返回就好。
     */
  }
  defineReactive(ob.value, key, val)
  ob.dep.notify()
  /**
   * --=--
   * 设置响应式对象，
   * 派发更新
   */
  return val
}

/**
 * Delete a property and trigger change if necessary.
 */
export function del (target: Array<any> | Object, key: any) {
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(`Cannot delete reactive property on undefined, null, or primitive value: ${(target: any)}`)
  }
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.splice(key, 1)
    return
  }
  const ob = (target: any).__ob__
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid deleting properties on a Vue instance or its root $data ' +
      '- just set it to null.'
    )
    return
  }
  if (!hasOwn(target, key)) {
    return
  }
  delete target[key]
  if (!ob) {
    return
  }
  ob.dep.notify()
}

/**
 * Collect dependencies on array elements when the array is touched, since
 * we cannot intercept array element access like property getters.
 */
function dependArray (value: Array<any>) {
  for (let e, i = 0, l = value.length; i < l; i++) {
    e = value[i]
    e && e.__ob__ && e.__ob__.dep.depend()
    if (Array.isArray(e)) {
      dependArray(e)
    }
  }
}
