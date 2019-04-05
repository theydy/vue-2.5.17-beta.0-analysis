/* @flow */

import type Watcher from './watcher'
import { remove } from '../util/index'

let uid = 0

/**
 * A dep is an observable that can have multiple
 * directives subscribing to it.
 */
export default class Dep {
  static target: ?Watcher;
  id: number;
  subs: Array<Watcher>;

  constructor () {
    this.id = uid++
    this.subs = []
    /**
     * --=--
     * id：每个 Dep 实例唯一递增的标识
     * subs：这个 Dep 收集到的 watcher 队列
     */
  }

  addSub (sub: Watcher) {
    this.subs.push(sub)
  }

  removeSub (sub: Watcher) {
    remove(this.subs, sub)
  }

  depend () {
    if (Dep.target) {
      Dep.target.addDep(this)
      /**
       * --=--
       * Dep.target 是当前正在计算的 watcher
       * 所以这里相当于 watcher.addDep(this)，this 是当前的 Dep 实例。
       * 即当前的 watcher 实例添加当前的 Dep 实例到 watcher 的 deps 数组中。
       * 不过在 watcher 中最后还是调用的 dep.addSub(this) 这样把 watcher 加到 dep 的 subs 数组中的，
       * 既然这样，为什么这里不是直接 dep.addSub(Dep.target) 呢 ？
       * 因为在一个 nexttick 中可能触发了多次 getter，这样就可能添加重复的 watcher，
       * watcher 中：
       * this.deps = []
       * this.newDeps = []
       * this.depIds = new Set()
       * this.newDepIds = new Set()
       * 就是处理这个的。
       * 还有另一方面的原因是 watcher 中也要保存一份收集了自身的 dep 数组，
       * 当执行一个组件的销毁过程或 watcher 不再依赖某个属性时，
       * 相应的要把这个组件的 render watcher 从所有 dep 实例中删除，
       * 比起遍历所有的 dep 实例，遍历这个 watcher 中的 dep 数组更快。
       */
    }
  }

  notify () {
    // stabilize the subscriber list first
    const subs = this.subs.slice()
    for (let i = 0, l = subs.length; i < l; i++) {
      subs[i].update()
      /**
       * --=--
       * subs 中存放的是收集到的 watcher，遍历调用 watcher 的 update 方法，更新视图。
       */
    }
  }
}

// the current target watcher being evaluated.
// this is globally unique because there could be only one
// watcher being evaluated at any time.
Dep.target = null
/**
 * --=--
 * Dep.target 是一个全局的 watcher
 * 表示当前计算的 watcher
 */
const targetStack = []

export function pushTarget (_target: ?Watcher) {
  if (Dep.target) targetStack.push(Dep.target)
  Dep.target = _target
}

export function popTarget () {
  Dep.target = targetStack.pop()
}
