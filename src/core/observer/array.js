/*
 * not type checking this file because flow doesn't play well with
 * dynamically accessing methods on Array prototype
 */

import { def } from '../util/index'

const arrayProto = Array.prototype
export const arrayMethods = Object.create(arrayProto)

const methodsToPatch = [
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse'
]

/**
 * Intercept mutating methods and emit events
 */
methodsToPatch.forEach(function (method) {
  /**
   * --=--
   * Object.defineProperty 只能针对对象下的属性做 getter, setter 的设置，
   * 也就是说对于 Array，直接访问 array[0] 或者 array[0] = xx 这样修改数组的值，
   * 都不会触发 getter 和 setter，毕竟也没有对于 Array 设置 getter, setter。
   * getter, setter 是对 Object 设置的。
   * 那么为了数组也能正确的执行依赖收集和派发更新的操作，
   * 一是在 Object 的 getter 中判断如果值是一个数组，
   * 会遍历数组下的属性全都收集一次当前的 watcher，如果值中还嵌套了数组就递归调用一次。
   * 二就是修改数组的变异方法，在变异方法中派发更新。
   * 
   * 强行用 Object.defineProperty(array, 1, {}) 实验了下，倒是可以设置。
   * 而且还能用下标触发 getter, setter，惊了，不过这样做确实不是一个正常的下标属性。
   * 用 for-in 循环不出来，for-of 反而可以循环出来，神奇。
   * 原本 for-in 是要循环出数组的自定义属性的，for-of 不循环，怎么还反过来了，绝了。
   */
  // cache original method
  const original = arrayProto[method]
  def(arrayMethods, method, function mutator (...args) {
    const result = original.apply(this, args)
    const ob = this.__ob__
    let inserted
    switch (method) {
      case 'push':
      case 'unshift':
        inserted = args
        break
      case 'splice':
        inserted = args.slice(2)
        break
    }
    if (inserted) ob.observeArray(inserted)
    /**
     * --=--
     * 数组中添加了新属性，新值可能是一个对象或数组，所以要做一次观测。
     * 接下来派发更新，updateComponent 执行过程中又做一次依赖收集。
     */
    // notify change
    ob.dep.notify()
    /**
     * --=--
     * 派发更新
     */
    return result
  })
})
