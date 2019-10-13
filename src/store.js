import applyMixin from './mixin'
import devtoolPlugin from './plugins/devtool'
import ModuleCollection from './module/module-collection'
import { forEachValue, isObject, isPromise, assert } from './util'

let Vue // bind on install

// ! 仓库类
export class Store {
  constructor(options = {}) {
    // Auto install if it is not done yet and `window` has `Vue`.
    // To allow users to avoid auto-installation in some cases,
    // this code should be placed here. See #731
    // ! 使用 Vuex 为引入外链时的安装方法
    if (!Vue && typeof window !== 'undefined' && window.Vue) {
      install(window.Vue)
    }

    if (process.env.NODE_ENV !== 'production') {
      assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
      assert(
        typeof Promise !== 'undefined',
        `vuex requires a Promise polyfill in this browser.`
      )
      assert(
        this instanceof Store,
        `store must be called with the new operator.`
      )
    }

    // ! 获取插件配置和严格模式
    const { plugins = [], strict = false } = options

    // store internal state
    this._committing = false // ! 正常 commit mutation后设置为 true
    this._actions = Object.create(null)
    this._actionSubscribers = []
    this._mutations = Object.create(null)
    this._wrappedGetters = Object.create(null)
    this._modules = new ModuleCollection(options) // ! ① 初始化模块 - 模块收集
    this._modulesNamespaceMap = Object.create(null)
    this._subscribers = []
    this._watcherVM = new Vue() // ! 监听实例

    // bind commit and dispatch to self
    const store = this
    const { dispatch, commit } = this

    // ! 重新赋值，传入参数，便于在组件中 this.$store.dispatch 使用
    this.dispatch = function boundDispatch(type, payload) {
      return dispatch.call(store, type, payload)
    }
    this.commit = function boundCommit(type, payload, options) {
      return commit.call(store, type, payload, options)
    }

    // strict mode
    this.strict = strict // ! 严格模式

    const state = this._modules.root.state // ! 根状态

    // init root module.
    // this also recursively registers all sub-modules
    // and collects all module getters inside this._wrappedGetters
    installModule(this, state, [], this._modules.root) // ! ② 安装模块

    // initialize the store vm, which is responsible for the reactivity
    // (also registers _wrappedGetters as computed properties)
    resetStoreVM(this, state) // ! ③ 初始化 store._vm

    // apply plugins
    plugins.forEach(plugin => plugin(this)) // ! 执行所有插件

    // ! 激活调试工具
    const useDevtools =
      options.devtools !== undefined ? options.devtools : Vue.config.devtools
    if (useDevtools) {
      devtoolPlugin(this)
    }
  }

  // ! 获取 state，触发响应式 @API
  get state() {
    return this._vm._data.$$state
  }

  set state(v) {
    if (process.env.NODE_ENV !== 'production') {
      assert(false, `use store.replaceState() to explicit replace store state.`)
    }
  }

  // ! commit 方法 @API
  commit(_type, _payload, _options) {
    // check object-style commit
    const { type, payload, options } = unifyObjectStyle(
      _type,
      _payload,
      _options
    )

    const mutation = { type, payload }
    const entry = this._mutations[type] // ! 获取对应 mutation 的函数数组
    if (!entry) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[vuex] unknown mutation type: ${type}`)
      }
      return
    }
    // ! 执行 commit前，设置 _committing 的状态
    this._withCommit(() => {
      entry.forEach(function commitIterator(handler) {
        handler(payload) // ! 执行 commit的所有函数
      })
    })
    this._subscribers.forEach(sub => sub(mutation, this.state)) // ! 执行 commit 订阅函数

    if (process.env.NODE_ENV !== 'production' && options && options.silent) {
      console.warn(
        `[vuex] mutation type: ${type}. Silent option has been removed. ` +
          'Use the filter functionality in the vue-devtools'
      )
    }
  }

  // ! dispatch 方法 @API
  dispatch(_type, _payload) {
    // check object-style dispatch
    const { type, payload } = unifyObjectStyle(_type, _payload)

    const action = { type, payload }
    const entry = this._actions[type]
    if (!entry) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[vuex] unknown action type: ${type}`)
      }
      return
    }

    // ! 执行 dispatch 订阅函数
    try {
      this._actionSubscribers
        .filter(sub => sub.before)
        .forEach(sub => sub.before(action, this.state))
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[vuex] error in before action subscribers: `)
        console.error(e)
      }
    }

    const result =
      entry.length > 1
        ? Promise.all(entry.map(handler => handler(payload))) // ! 执行 action 的所有异步操作
        : entry[0](payload)

    return result.then(res => {
      try {
        this._actionSubscribers
          .filter(sub => sub.after)
          .forEach(sub => sub.after(action, this.state))
      } catch (e) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[vuex] error in after action subscribers: `)
          console.error(e)
        }
      }
      return res
    })
  }

  // ! 订阅 mutation 方法 @API
  subscribe(fn) {
    return genericSubscribe(fn, this._subscribers)
  }

  // ! 订阅 action 方法 @API
  subscribeAction(fn) {
    const subs = typeof fn === 'function' ? { before: fn } : fn
    return genericSubscribe(subs, this._actionSubscribers)
  }

  // ! 监听 @API
  watch(getter, cb, options) {
    if (process.env.NODE_ENV !== 'production') {
      assert(
        typeof getter === 'function',
        `store.watch only accepts a function.`
      )
    }
    return this._watcherVM.$watch(
      () => getter(this.state, this.getters),
      cb,
      options
    )
  }

  // ! 替换 state 主要用于服务端渲染的脱水
  replaceState(state) {
    this._withCommit(() => {
      this._vm._data.$$state = state
    })
  }

  // ! 动态注册模块
  registerModule(path, rawModule, options = {}) {
    if (typeof path === 'string') path = [path] // ! 转成数组

    if (process.env.NODE_ENV !== 'production') {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
      assert(
        path.length > 0,
        'cannot register the root module by using registerModule.'
      )
    }

    this._modules.register(path, rawModule) // ! 注册模块

    // ! 安装模块
    installModule(
      this,
      this.state,
      path,
      this._modules.get(path),
      options.preserveState
    )
    // reset store to update getters...
    // ! 初始化 store._vm
    resetStoreVM(this, this.state)
  }

  // ! 动态卸载模块
  unregisterModule(path) {
    if (typeof path === 'string') path = [path]

    if (process.env.NODE_ENV !== 'production') {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    this._modules.unregister(path) // ! 注销模块
    this._withCommit(() => {
      const parentState = getNestedState(this.state, path.slice(0, -1))
      Vue.delete(parentState, path[path.length - 1]) // ! 删除 state 在该路径下的引用
    })
    resetStore(this) // ! 重置 store
  }

  hotUpdate(newOptions) {
    this._modules.update(newOptions)
    resetStore(this, true)
  }

  // ! 包装 commit；设置 _committing 状态
  // ! 正常执行 commit 后 _committing 为 true，防止随意更改 vuex 的数据
  _withCommit(fn) {
    const committing = this._committing
    this._committing = true
    fn()
    this._committing = committing
  }
}

// ! 生成订阅器的方法
function genericSubscribe(fn, subs) {
  if (subs.indexOf(fn) < 0) {
    subs.push(fn)
  }
  return () => {
    const i = subs.indexOf(fn)
    if (i > -1) {
      subs.splice(i, 1)
    }
  }
}

// ! 重置 store 的方法；先清空，再重新安装和初始化
function resetStore(store, hot) {
  store._actions = Object.create(null)
  store._mutations = Object.create(null)
  store._wrappedGetters = Object.create(null)
  store._modulesNamespaceMap = Object.create(null)
  const state = store.state
  // init all modules
  installModule(store, state, [], store._modules.root, true)
  // reset vm
  resetStoreVM(store, state, hot)
}

// ! 初始化 store._vm 的方法；设置 state 和 getters 为响应式
function resetStoreVM(store, state, hot) {
  const oldVm = store._vm // ! 缓存旧的 vm

  // bind store public getters
  store.getters = {} // ! 公开属性 getters
  const wrappedGetters = store._wrappedGetters // ! 获取包装的 getter
  const computed = {} // ! 设置计算属性对象
  // ! 遍历 getters
  forEachValue(wrappedGetters, (fn, key) => {
    // use computed to leverage its lazy-caching mechanism
    computed[key] = () => fn(store) // ! 计算属性的值为原生 getter 的返回值
    // ! 代理 store.getters 的属性
    // ! getter store.getters.xxx => store._vm.computed[xxx] => store._vm[xxx]
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],
      enumerable: true // for local getters
    })
  })

  // use a Vue instance to store the state tree
  // suppress warnings just in case the user has added
  // some funky global mixins
  const silent = Vue.config.silent
  Vue.config.silent = true

  // ! 实例化 store._vm；绑定 state 和 getter 为 Vue 实例的 data 和 computed 属性；实现响应式
  store._vm = new Vue({
    data: {
      $$state: state // ! store.state = store._vm.data.$$state
    },
    computed // ! 传入到 Vue 实例
  })
  Vue.config.silent = silent

  // enable strict mode for new vm
  // ! 严格模式；在开发环境中，确保只能通过 commit来修改 state 的值
  if (store.strict) {
    enableStrictMode(store)
  }

  // ! 热更新时，销毁旧的 vm
  if (oldVm) {
    if (hot) {
      // dispatch changes in all subscribed watchers
      // to force getter re-evaluation for hot reloading.
      store._withCommit(() => {
        oldVm._data.$$state = null // ! 数据重置为 null
      })
    }
    Vue.nextTick(() => oldVm.$destroy())
  }
}

/**
 * ! 安装模块的方法
 * @param {*} store 根 store
 * @param {*} rootState 根状态
 * @param {*} path 路径
 * @param {*} module 当前模块
 * @param {*} hot 是否是热更新
 */
function installModule(store, rootState, path, module, hot) {
  const isRoot = !path.length // ! 判断是否是根模块
  const namespace = store._modules.getNamespace(path) // ! 获取命名空间的模块名 'moduleName/'

  // register in namespace map
  // ! 如果设置了命名空间；namespaced = true
  if (module.namespaced) {
    store._modulesNamespaceMap[namespace] = module // ! 添加到映射表
  }

  // set state
  if (!isRoot && !hot) {
    const parentState = getNestedState(rootState, path.slice(0, -1)) // ! 获取父模块的状态
    const moduleName = path[path.length - 1] // ! 获取父模块的模块名
    store._withCommit(() => {
      Vue.set(parentState, moduleName, module.state) // ! 设置状态
    })
  }

  // ! 构造了一个本地上下文环境（模块内部）
  const local = (module.context = makeLocalContext(store, namespace, path))

  // ! 遍历和注册，下同
  module.forEachMutation((mutation, key) => {
    const namespacedType = namespace + key // ! 获取 key 值，拼接好命名空间的类型 => 'moduleName/mutationName'
    registerMutation(store, namespacedType, mutation, local) // ! 注册
  })

  module.forEachAction((action, key) => {
    const type = action.root ? key : namespace + key // ! action 可能是个对象
    const handler = action.handler || action
    registerAction(store, type, handler, local)
  })

  module.forEachGetter((getter, key) => {
    const namespacedType = namespace + key
    registerGetter(store, namespacedType, getter, local)
  })

  // ! 遍历子模块，递归注册模块
  module.forEachChild((child, key) => {
    installModule(store, rootState, path.concat(key), child, hot) // ! path 拼接 key
  })
}

/**
 * make localized dispatch, commit, getters and state
 * if there is no namespace, just use root ones
 * ! 创建本地上下文的方法
 * @param store 根 store
 * @param namespace 模块的命名空间
 * @param path 路径
 */
function makeLocalContext(store, namespace, path) {
  const noNamespace = namespace === ''

  // ! 重写有命名空间的模块里面的  dispatch commit getters state
  const local = {
    dispatch: noNamespace // ! 没有命名空间
      ? store.dispatch // ! 调用根的 dispatch
      : (_type, _payload, _options) => {
          const args = unifyObjectStyle(_type, _payload, _options)
          const { payload, options } = args
          let { type } = args

          if (!options || !options.root) {
            type = namespace + type // ! 拼接 type => 'moduleName/mutationName'
            if (
              process.env.NODE_ENV !== 'production' &&
              !store._actions[type]
            ) {
              console.error(
                `[vuex] unknown local action type: ${
                  args.type
                }, global type: ${type}`
              )
              return
            }
          }

          return store.dispatch(type, payload) // ! 传入新的 type 为参数
        },

    commit: noNamespace
      ? store.commit
      : (_type, _payload, _options) => {
          const args = unifyObjectStyle(_type, _payload, _options)
          const { payload, options } = args
          let { type } = args

          if (!options || !options.root) {
            type = namespace + type
            if (
              process.env.NODE_ENV !== 'production' &&
              !store._mutations[type]
            ) {
              console.error(
                `[vuex] unknown local mutation type: ${
                  args.type
                }, global type: ${type}`
              )
              return
            }
          }

          store.commit(type, payload, options)
        }
  }

  // getters and state object must be gotten lazily
  // because they will be changed by vm update
  Object.defineProperties(local, {
    getters: {
      get: noNamespace
        ? () => store.getters
        : () => makeLocalGetters(store, namespace)
    },
    state: {
      get: () => getNestedState(store.state, path)
    }
  })

  return local
}

// ! 创建本地 getters 的上下文，返回代理对象
function makeLocalGetters(store, namespace) {
  const gettersProxy = {}

  const splitPos = namespace.length // ! namespace 的长度
  Object.keys(store.getters).forEach(type => {
    // skip if the target getter is not match this namespace
    if (type.slice(0, splitPos) !== namespace) return

    // extract local getter type
    const localType = type.slice(splitPos) // ! 提取本地的 type moduleName/getterName => getterName

    // Add a port to the getters proxy.
    // Define as getter property because
    // we do not want to evaluate the getters in this time.
    // ! 代理 gettersProxy => gettersProxy.localType = store.getters[type]
    Object.defineProperty(gettersProxy, localType, {
      get: () => store.getters[type],
      enumerable: true
    })
  })

  return gettersProxy
}

// ! 注册 mutation
function registerMutation(store, type, handler, local) {
  const entry = store._mutations[type] || (store._mutations[type] = []) // ! 初始值为空数组
  entry.push(function wrappedMutationHandler(payload) {
    handler.call(store, local.state, payload) // ! 执行方法；上下文是根 store；传入参数 local.state，
  })
}

// ! 注册 action
function registerAction(store, type, handler, local) {
  const entry = store._actions[type] || (store._actions[type] = [])
  entry.push(function wrappedActionHandler(payload, cb) {
    let res = handler.call(
      store,
      // ! 传入多个参数，操作丰富
      {
        dispatch: local.dispatch,
        commit: local.commit,
        getters: local.getters,
        state: local.state,
        rootGetters: store.getters,
        rootState: store.state
      },
      payload,
      cb
    )
    // ! 判断返回值是否是异步，不是异步就调用 Promise.resolve() 异步化
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

// ! 注册 getter
function registerGetter(store, type, rawGetter, local) {
  if (store._wrappedGetters[type]) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }

  // ! 返回原生函数
  store._wrappedGetters[type] = function wrappedGetter(store) {
    return rawGetter(
      // ! 传入多个参数
      local.state, // local state
      local.getters, // local getters
      store.state, // root state
      store.getters // root getters
    )
  }
}

// ! 执行严格模式的方法
function enableStrictMode(store) {
  // ! 监听 store.state 的变化
  // ! 在开发环境，如果没有使用 commit 修改了 state 的值，会报错
  store._vm.$watch(
    function() {
      return this._data.$$state
    },
    () => {
      if (process.env.NODE_ENV !== 'production') {
        assert(
          store._committing,
          `do not mutate vuex store state outside mutation handlers.`
        )
      }
    },
    { deep: true, sync: true } // ! 深度监听，有性能消耗，只能在开发环境使用
  )
}

// ! 获取嵌套的 state 数据
function getNestedState(state, path) {
  return path.length ? path.reduce((state, key) => state[key], state) : state
}

// ! 统一对象风格 处理参数
function unifyObjectStyle(type, payload, options) {
  if (isObject(type) && type.type) {
    options = payload
    payload = type
    type = type.type
  }

  if (process.env.NODE_ENV !== 'production') {
    assert(
      typeof type === 'string',
      `expects string as the type, but found ${typeof type}.`
    )
  }

  return { type, payload, options }
}

// ! Vuex 安装方法
export function install(_Vue) {
  // ! 安装一次 单例模式
  if (Vue && _Vue === Vue) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(
        '[vuex] already installed. Vue.use(Vuex) should be called only once.'
      )
    }
    return
  }
  Vue = _Vue // ! 赋值给全局变量 Vue；共享 Vue
  applyMixin(Vue) // ! 混合
}
