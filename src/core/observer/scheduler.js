/* @flow */

import type Watcher from './watcher'
import config from '../config'
import { callHook, activateChildComponent } from '../instance/lifecycle'

import {
  warn,
  nextTick,
  devtools
} from '../util/index'

export const MAX_UPDATE_COUNT = 100

const queue: Array<Watcher> = []
const activatedChildren: Array<Component> = []
let has: { [key: number]: ?true } = {}
let circular: { [key: number]: number } = {}
let waiting = false
let flushing = false
let index = 0

/**
 * Reset the scheduler's state.
 */
function resetSchedulerState () {
  index = queue.length = activatedChildren.length = 0
  has = {}
  if (process.env.NODE_ENV !== 'production') {
    circular = {}
  }
  waiting = flushing = false
}

/**
 * Flush both queues and run the watchers.
 */
function flushSchedulerQueue () {
  /**
   * --=--
   * 1. 设置 flushing 状态
   * 2. queue 排序
   * 3. 遍历 queue 执行 watcher.run()
   * 4. resetSchedulerState() 还原状态变量
   * 5. 触发组件钩子函数
   */
  flushing = true
  let watcher, id

  // Sort queue before flush.
  // This ensures that:
  // 1. Components are updated from parent to child. (because parent is always
  //    created before the child)
  // 2. A component's user watchers are run before its render watcher (because
  //    user watchers are created before the render watcher)
  // 3. If a component is destroyed during a parent component's watcher run,
  //    its watchers can be skipped.
  /**
   * --=--
   * queue 根据 watcher 的 id 重小到大排列。
   * 1. 组件的更新由父到子，父组件先于子组件创建，所以父组件的 watcher id 也比子组件的 watcher id 小
   * 2. 用户的自定义 watcher 要优先于 render watcher 执行，用户自定义 watcher 是先于 render watcher 之前创建的
   * 3. 如果一个组件在父组件的 watcher 执行期间被销毁，那么这个组件对应的 watcher 执行都可以被跳过。
   */
  queue.sort((a, b) => a.id - b.id)

  // do not cache length because more watchers might be pushed
  // as we run existing watchers
  for (index = 0; index < queue.length; index++) {
    watcher = queue[index]
    if (watcher.before) {
      watcher.before()
      /**
       * --=--
       * 如果组件 _isMounted，则调用 beforeUpdate 钩子函数
       */
    }
    id = watcher.id
    has[id] = null
    watcher.run()
    /**
     * --=--
     * 执行 watcher 的更新，run 中调用了 getAndInvoke 方法，
     * getAndInvoke 方法中会执行 watcher 的 getter，对于 render watcher 来说，
     * 就是再次执行 updateComponent 函数了，也就是 render patch 的过程，完成视图的更新。
     */
    // in dev build, check and stop circular updates.
    if (process.env.NODE_ENV !== 'production' && has[id] != null) {
      /**
       * --=--
       * 处理循环更新 bug。
       */
      circular[id] = (circular[id] || 0) + 1
      if (circular[id] > MAX_UPDATE_COUNT) {
        warn(
          'You may have an infinite update loop ' + (
            watcher.user
              ? `in watcher with expression "${watcher.expression}"`
              : `in a component render function.`
          ),
          watcher.vm
        )
        break
      }
    }
  }

  // keep copies of post queues before resetting state
  const activatedQueue = activatedChildren.slice()
  const updatedQueue = queue.slice()

  resetSchedulerState()

  // call component updated and activated hooks
  callActivatedHooks(activatedQueue)
  callUpdatedHooks(updatedQueue)

  // devtool hook
  /* istanbul ignore if */
  if (devtools && config.devtools) {
    devtools.emit('flush')
  }
}

function callUpdatedHooks (queue) {
  let i = queue.length
  while (i--) {
    const watcher = queue[i]
    const vm = watcher.vm
    if (vm._watcher === watcher && vm._isMounted) {
      /**
       * --=--
       * 如果是一个渲染 watcher 并且已经 mounted 过了，调用 updated 钩子函数
       */
      callHook(vm, 'updated')
    }
  }
}

/**
 * Queue a kept-alive component that was activated during patch.
 * The queue will be processed after the entire tree has been patched.
 */
export function queueActivatedComponent (vm: Component) {
  // setting _inactive to false here so that a render function can
  // rely on checking whether it's in an inactive tree (e.g. router-view)
  vm._inactive = false
  activatedChildren.push(vm)
}

function callActivatedHooks (queue) {
  for (let i = 0; i < queue.length; i++) {
    queue[i]._inactive = true
    activateChildComponent(queue[i], true /* true */)
  }
}

/**
 * Push a watcher into the watcher queue.
 * Jobs with duplicate IDs will be skipped unless it's
 * pushed when the queue is being flushed.
 */
export function queueWatcher (watcher: Watcher) {
  const id = watcher.id
  if (has[id] == null) {
    /**
     * --=--
     * queue 添加更新的 watcher 时，会做一个去重的优化。
     */
    has[id] = true
    if (!flushing) {
      queue.push(watcher)
    } else {
      // if already flushing, splice the watcher based on its id
      // if already past its id, it will be run next immediately.
      /**
       * --=--
       * 在 nextTick 执行 watcher 更新的过程中，如果 watcher 的回调函数又触发了
       * queueWatcher，就会走到这部分逻辑中。
       */
      let i = queue.length - 1
      while (i > index && queue[i].id > watcher.id) {
        i--
      }
      queue.splice(i + 1, 0, watcher)
    }
    // queue the flush
    if (!waiting) {
      /**
       * --=--
       * 在一个 event loop 中第一次走进 queueWatcher 时，会走这块逻辑。
       * 在 nextTick 中处理 flushSchedulerQueue 这个函数。
       * nextTick 的实现在 2.6 版本中已经全部用 Promise 实现了，
       * 所以这里可以认为是在微任务队列中添加一个 flushSchedulerQueue
       */
      waiting = true
      nextTick(flushSchedulerQueue)
    }
  }
}
