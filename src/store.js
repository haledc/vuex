import { reactive, computed, watch } from 'vue'
import { storeKey } from './injectKey'
import devtoolPlugin from './plugins/devtool'
import ModuleCollection from './module/module-collection'
import { forEachValue, isObject, isPromise, assert, partial } from './util'

export function createStore (options) {
  return new Store(options)
}

// ! 仓库类
export class Store {
  constructor (options = {}) {
    if (__DEV__) {
      assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
      assert(this instanceof Store, `store must be called with the new operator.`)
    }

    // ! 获取选项中的插件（默认是空数组）和严格模式定义（默认是 false）
    const {
      plugins = [],
      strict = false
    } = options

    // store internal state
    this._committing = false // ! 判断是否使用 commit 修改数据
    this._actions = Object.create(null) // ! 存储 actions
    this._actionSubscribers = [] // ! 存储 action 的所有订阅函数
    this._mutations = Object.create(null) // ! 存储 mutations
    this._wrappedGetters = Object.create(null) // ! 存储 wrapper getters
    this._modules = new ModuleCollection(options) // ! ⭐① 模块收集 => { root: rootModule }
    this._modulesNamespaceMap = Object.create(null) // ! 模块命名映射表 { 'moduleName/': module}
    this._subscribers = [] // ! 存储 mutation 的所有订阅函数
    this._makeLocalGettersCache = Object.create(null) // ! 模块的 getters

    // bind commit and dispatch to self
    const store = this
    const { dispatch, commit } = this
    // ! 绑定 this，指向 store 实例本身
    this.dispatch = function boundDispatch (type, payload) {
      return dispatch.call(store, type, payload)
    }
    this.commit = function boundCommit (type, payload, options) {
      return commit.call(store, type, payload, options)
    }

    // strict mode
    this.strict = strict // ! 在严格模式下，任何 mutation 处理函数以外修改 Vuex state 都会抛出错误

    const state = this._modules.root.state // ! 获取根的 state

    // init root module.
    // this also recursively registers all sub-modules
    // and collects all module getters inside this._wrappedGetters
    installModule(this, state, [], this._modules.root) // ! ⭐② 安装 root 模块 ，模块初始化

    // initialize the store state, which is responsible for the reactivity
    // (also registers _wrappedGetters as computed properties)
    resetStoreState(this, state) // ! ⭐③ 初始化 state

    // apply plugins
    plugins.forEach(plugin => plugin(this)) // ! 调用所有插件函数

    // ! 处理 devtool 插件
    const useDevtools = options.devtools !== undefined ? options.devtools : /* Vue.config.devtools */ true
    if (useDevtools) {
      devtoolPlugin(this) // ! 安装 devtool 插件
    }
  }

  // ! 安装方法
  install (app, injectKey) {
    app.provide(injectKey || storeKey, this) // ! provide store
    app.config.globalProperties.$store = this // ! global property
  }

  // ! 获取 state，访问的是 Vue 的 data 里面的属性，触发响应式 @API
  get state () {
    return this._state.data
  }

  // ! 设置 state，开发环境会报错，不能直接设置，必须使用 replaceState 替换
  set state (v) {
    if (__DEV__) {
      assert(false, `use store.replaceState() to explicit replace store state.`)
    }
  }

  // ! commit 方法 @API
  commit (_type, _payload, _options) {
    // check object-style commit
    const {
      type,
      payload,
      options
    } = unifyObjectStyle(_type, _payload, _options)

    const mutation = { type, payload }
    const entry = this._mutations[type] // ! 获取 type 的 mutation 函数数组
    if (!entry) {
      if (__DEV__) {
        console.error(`[vuex] unknown mutation type: ${type}`)
      }
      return
    }

    // ! 使用 commit 执行 mutation 时在严格模式下不会报错
    this._withCommit(() => {
      entry.forEach(function commitIterator (handler) {
        handler(payload)
      })
    })

    this._subscribers
      .slice() // shallow copy to prevent iterator invalidation if subscriber synchronously calls unsubscribe
      .forEach(sub => sub(mutation, this.state)) // ! 执行 mutation 后，执行所有订阅函数

    if (
      __DEV__ &&
      options && options.silent
    ) {
      console.warn(
        `[vuex] mutation type: ${type}. Silent option has been removed. ` +
        'Use the filter functionality in the vue-devtools'
      )
    }
  }

  // ! dispatch 方法 @API
  dispatch (_type, _payload) {
    // check object-style dispatch
    const {
      type,
      payload
    } = unifyObjectStyle(_type, _payload)

    const action = { type, payload }
    const entry = this._actions[type]
    if (!entry) {
      if (__DEV__) {
        console.error(`[vuex] unknown action type: ${type}`)
      }
      return
    }

    // ! action 执行前，先执行 action 的所有订阅器的 before 函数
    try {
      this._actionSubscribers
        .slice() // shallow copy to prevent iterator invalidation if subscriber synchronously calls unsubscribe
        .filter(sub => sub.before)
        .forEach(sub => sub.before(action, this.state))
    } catch (e) {
      if (__DEV__) {
        console.warn(`[vuex] error in before action subscribers: `)
        console.error(e)
      }
    }

    const result = entry.length > 1
      ? Promise.all(entry.map(handler => handler(payload))) // ! 并行执行 action 的所有异步操作
      : entry[0](payload) // ! 只有一个 action 则同步执行

    // ! action 执行后，再执行 action 的所有订阅器的 after 函数
    return new Promise((resolve, reject) => {
      result.then(res => {
        try {
          this._actionSubscribers
            .filter(sub => sub.after)
            .forEach(sub => sub.after(action, this.state))
        } catch (e) {
          if (__DEV__) {
            console.warn(`[vuex] error in after action subscribers: `)
            console.error(e)
          }
        }
        resolve(res)
      }, error => {
        try {
          this._actionSubscribers
            .filter(sub => sub.error)
            .forEach(sub => sub.error(action, this.state, error))
        } catch (e) {
          if (__DEV__) {
            console.warn(`[vuex] error in error action subscribers: `)
            console.error(e)
          }
        }
        reject(error)
      })
    })
  }

  // ! 订阅 mutation @API
  subscribe (fn, options) {
    return genericSubscribe(fn, this._subscribers, options) // ! 就是把 fn 放入到 _subscribers 中，并返回一个函数删除 fn
  }

  // ! 订阅 action @API
  subscribeAction (fn, options) {
    const subs = typeof fn === 'function' ? { before: fn } : fn // ! fn 是函数则设置为 before 属性
    return genericSubscribe(subs, this._actionSubscribers, options)
  }

  // ! 监听 @API
  // ! 监听 getter 的返回值，并执行 cb
  watch (getter, cb, options) {
    if (__DEV__) {
      assert(typeof getter === 'function', `store.watch only accepts a function.`)
    }

    // ! watch -> 接受 state 和 getter 作为参数
    return watch(() => getter(this.state, this.getters), cb, Object.assign({}, options))
  }

  // ! 替换 state 的根数据，这里也是提交 commit 进行数据修改
  replaceState (state) {
    this._withCommit(() => {
      this._state.data = state
    })
  }

  // ! 动态注册模块，在模块初始化后手动注册模块 @API
  registerModule (path, rawModule, options = {}) {
    if (typeof path === 'string') path = [path] // ! 字符串包装成数组

    if (__DEV__) {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
      assert(path.length > 0, 'cannot register the root module by using registerModule.')
    }

    this._modules.register(path, rawModule) // ! 注册模块
    installModule(this, this.state, path, this._modules.get(path), options.preserveState) // ! 安装模块
    // reset store to update getters...
    resetStoreState(this, this.state)
  }

  // ! 动态卸载模块 @API
  unregisterModule (path) {
    if (typeof path === 'string') path = [path]

    if (__DEV__) {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    this._modules.unregister(path) // ! 注销模块
    this._withCommit(() => {
      const parentState = getNestedState(this.state, path.slice(0, -1))
      delete parentState[path[path.length - 1]] // ! 删除 state 在该路径下的引用
    })
    resetStore(this) // ! 重置 store
  }

  // ! 查询模块
  hasModule (path) {
    if (typeof path === 'string') path = [path]

    if (__DEV__) {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    return this._modules.isRegistered(path)
  }

  // ! 模块热重载 @API
  // ! newOptions 是需要重载的数据
  hotUpdate (newOptions) {
    this._modules.update(newOptions)
    resetStore(this, true)
  }

  // ! 包装 commit，设置 _committing 状态
  // ! 正常通过 commit 修改数据前 _committing 为 true，防止用户随意更改 vuex 的数据
  _withCommit (fn) {
    const committing = this._committing // ! 缓存原来的状态
    this._committing = true // ! 执行前设置为 true，此时通过 commit 修改值在严格模式下不会报错
    fn() // ! 执行函数
    this._committing = committing // ! 恢复原来的状态
  }
}

// ! 生成订阅器，把 fn 放入到 subs 中，返回一个取消订阅器的函数，从 subs 中删除 fn
function genericSubscribe (fn, subs, options) {
  if (subs.indexOf(fn) < 0) {
    options && options.prepend
      ? subs.unshift(fn)
      : subs.push(fn)
  }
  return () => {
    const i = subs.indexOf(fn)
    if (i > -1) {
      subs.splice(i, 1)
    }
  }
}

// ! 重置 store -> 先清空数据，再重新安装模块和初始化数据
function resetStore (store, hot) {
  // ! 重新设置值为空对象
  store._actions = Object.create(null)
  store._mutations = Object.create(null)
  store._wrappedGetters = Object.create(null)
  store._modulesNamespaceMap = Object.create(null)
  const state = store.state
  // init all modules
  installModule(store, state, [], store._modules.root, true)
  // reset state
  resetStoreState(store, state, hot)
}

// ! 初始化数据 -> 设置 state 和 getters 为响应式数据
function resetStoreState (store, state, hot) {
  const oldState = store._state // ! 缓存旧的 state，用于热重载

  // bind store public getters
  store.getters = {} // ! 创建 getters 属性
  // reset local getters cache
  store._makeLocalGettersCache = Object.create(null)
  const wrappedGetters = store._wrappedGetters // ! 获取 wrappedGetters 对象
  const computedObj = {}
  // ! 遍历 wrappedGetters
  forEachValue(wrappedGetters, (fn, key) => {
    // use computed to leverage its lazy-caching mechanism
    // direct inline function use will lead to closure preserving oldVm.
    // using partial to return function with only arguments preserved in closure environment.
    computedObj[key] = partial(fn, store)

    // ! 定义 store.getters 的属性
    Object.defineProperty(store.getters, key, {
      get: () => computed(() => computedObj[key]()).value, // ! computed -> getter 变成响应式数据
      enumerable: true // for local getters
    })
  })

  // ! reactive -> state 变成响应式数据
  store._state = reactive({
    data: state
  })

  // enable strict mode for new state
  // ! 在严格模式下，确保只能通过 commit 来显示的修改 state 的值
  if (store.strict) {
    enableStrictMode(store)
  }

  // ! 热重载处理
  if (oldState) {
    if (hot) {
      // dispatch changes in all subscribed watchers
      // to force getter re-evaluation for hot reloading.
      store._withCommit(() => {
        oldState.data = null
      })
    }
  }
}

// ! 安装模块 -> 把模块放入到 store 实例属性中，构建 module tree
function installModule (store, rootState, path, module, hot) {
  const isRoot = !path.length
  const namespace = store._modules.getNamespace(path) // ! 获取命名空间模块的名称 -> 'moduleName/'

  // register in namespace map
  // ! 如果设置了模块命名空间，即 namespaced = true
  if (module.namespaced) {
    if (store._modulesNamespaceMap[namespace] && __DEV__) {
      console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
    }
    store._modulesNamespaceMap[namespace] = module // ! 添加到命名映射表中
  }

  // set state
  if (!isRoot && !hot) {
    const parentState = getNestedState(rootState, path.slice(0, -1)) // ! 获取父级 state
    const moduleName = path[path.length - 1] // ! 获取模块名
    store._withCommit(() => {
      if (__DEV__) {
        if (moduleName in parentState) {
          console.warn(
            `[vuex] state field "${moduleName}" was overridden by a module with the same name at "${path.join('.')}"`
          )
        }
      }
      parentState[moduleName] = module.state // ! 设置子模块，建立父子关系，并且为响应性数据
    })
  }

  // ! 构造了一个模块上下文环境（模块内部）
  // ! local 中的 commit dispatch state getter 的效果会不一样
  const local = module.context = makeLocalContext(store, namespace, path)

  // ! 遍历和注册模块，下同
  module.forEachMutation((mutation, key) => {
    const namespacedType = namespace + key // ! 拼接 type -> 'moduleName/mutationName'
    registerMutation(store, namespacedType, mutation, local)
  })

  module.forEachAction((action, key) => {
    const type = action.root ? key : namespace + key // ! 是否拼接 type -> 'moduleName/actionName'
    const handler = action.handler || action // ! 获取 action 处理函数
    registerAction(store, type, handler, local)
  })

  module.forEachGetter((getter, key) => {
    const namespacedType = namespace + key // ! 拼接 type -> 'moduleName/getterName'
    registerGetter(store, namespacedType, getter, local)
  })

  // ! 递归注册子模块
  module.forEachChild((child, key) => {
    installModule(store, rootState, path.concat(key), child, hot) // ! path 连接 key(模块名)
  })
}

/**
 * make localized dispatch, commit, getters and state
 * if there is no namespace, just use root ones
 */
// ! 创建模块上下文的方法 -> 创建本地模块的 local 用来操作 type 是模块里面的，而不是根的
// ! 重写有命名空间的模块里面的 dispatch commit 方法和 getters state 属性
function makeLocalContext (store, namespace, path) {
  const noNamespace = namespace === ''

  // ! 创建 local 属性
  const local = {
    // ! 没有命名空间，直接使用根的 dispatch --> dispatch(actionName, payload)
    dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      // ! options: { root: true } -> 也不会拼接命名空间
      if (!options || !options.root) {
        type = namespace + type // ! 拼接 type => 'moduleName/actionName'
        if (__DEV__ && !store._actions[type]) {
          console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
          return
        }
      }

      // ! 传入新的 type 为参数 -> dispatch(moduleName/actionName, payload)
      return store.dispatch(type, payload)
    },

    commit: noNamespace ? store.commit : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) {
        type = namespace + type
        if (__DEV__ && !store._mutations[type]) {
          console.error(`[vuex] unknown local mutation type: ${args.type}, global type: ${type}`)
          return
        }
      }

      store.commit(type, payload, options)
    }
  }

  // getters and state object must be gotten lazily
  // because they will be changed by state update
  Object.defineProperties(local, {
    getters: {
      get: noNamespace
        ? () => store.getters
        : () => makeLocalGetters(store, namespace) // ! 使用一个对象来代理模块里面的 getters
    },
    state: {
      get: () => getNestedState(store.state, path) // ! 通过路径获取嵌套的 state
    }
  })

  return local
}

// ! 创建本地 getters 的方法，返回代理对象
function makeLocalGetters (store, namespace) {
  // ! 添加模块的 getters 到 _makeLocalGettersCache 中
  if (!store._makeLocalGettersCache[namespace]) {
    const gettersProxy = {}
    const splitPos = namespace.length // ! 分割点：namespace 的长度
    Object.keys(store.getters).forEach(type => {
      // skip if the target getter is not match this namespace
      if (type.slice(0, splitPos) !== namespace) return // ! 命名空间和 type 的模块名不一致时直接返回，即没有匹配成功

      // extract local getter type
      const localType = type.slice(splitPos) // ! 截取 type 名称 moduleName/getterName -> getterName

      // Add a port to the getters proxy.
      // Define as getter property because
      // we do not want to evaluate the getters in this time.
      // ! 定义 gettersProxy -> gettersProxy.localType = store.getters[type]
      Object.defineProperty(gettersProxy, localType, {
        get: () => store.getters[type],
        enumerable: true
      })
    })
    store._makeLocalGettersCache[namespace] = gettersProxy
  }

  return store._makeLocalGettersCache[namespace]
}

// ! 注册 mutations -> 把封装好的 mutation 放入到 _mutations 中
function registerMutation (store, type, handler, local) {
  const entry = store._mutations[type] || (store._mutations[type] = [])

  // ! _mutations = { 'moduleName/mutationName': [wrappedMutationHandler] }
  entry.push(function wrappedMutationHandler (payload) {
    handler.call(store, local.state, payload) // ! mutationFn(local.state, payload)
  })
}

// ! 注册 actions -> 把封装好的 action 放入到 _actions 中
function registerAction (store, type, handler, local) {
  const entry = store._actions[type] || (store._actions[type] = [])
  entry.push(function wrappedActionHandler (payload) {
    // ! 调用原生函数 handler
    let res = handler.call(store, {
      // ! 第一个参数有很多选项，注意区分是模块 local 的属性还是根 store 的属性
      dispatch: local.dispatch,
      commit: local.commit,
      getters: local.getters,
      state: local.state,
      rootGetters: store.getters,
      rootState: store.state
    }, payload) // ! actionFn({ dispatch... rootState }, payload)

    // ! 判断返回值是否是 Promise，不是就调用 Promise.resolve() 转换成 Promise
    if (!isPromise(res)) {
      res = Promise.resolve(res)
    }
    if (store._devtoolHook) {
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {
      return res
    }
  })
}

// ! 注册 getters -> 把封装好的 getter 放入到 _wrappedGetters 中
function registerGetter (store, type, rawGetter, local) {
  // ! 已经注册
  if (store._wrappedGetters[type]) {
    if (__DEV__) {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }

  // ! 调用原生函数，并传入相关参数
  store._wrappedGetters[type] = function wrappedGetter (store) {
    return rawGetter(
      local.state, // local state
      local.getters, // local getters
      store.state, // root state
      store.getters // root getters
    )
  }
}

// ! 启动严格模式 -> 监听 state 变化时 commit 的状态
function enableStrictMode (store) {
  // ! 在开发环境，如果没有使用 commit 修改了 state 的值，会报错
  watch(() => store._state.data, () => {
    if (__DEV__) {
      assert(store._committing, `do not mutate vuex store state outside mutation handlers.`)
    }
  }, { deep: true, flush: 'sync' }) // ! 深度监听和同步执行，有性能消耗，所以只能在开发环境使用 strict
}

// ! 获取嵌套的 state 数据
function getNestedState (state, path) {
  return path.reduce((state, key) => state[key], state)
}

// ! 规范化 commit 和 dispatch 函数的参数
// ! e.g. 1. commit(type: string, payload?: any, options?: Object)
// !      2. commit({ type: string, payload?: any }, options? Object)
function unifyObjectStyle (type, payload, options) {
  if (isObject(type) && type.type) {
    options = payload
    payload = type
    type = type.type
  }

  if (__DEV__) {
    assert(typeof type === 'string', `expects string as the type, but found ${typeof type}.`)
  }

  return { type, payload, options }
}
