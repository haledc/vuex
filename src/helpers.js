import { isObject } from './util'

/**
 * Reduce the code which written in Vue.js for getting the state.
 * @param {String} [namespace] - Module's namespace
 * @param {Object|Array} states # Object's item can be a function which accept state and getters for param, you can do something for state and getters in it.
 * @param {Object}
 */
export const mapState = normalizeNamespace((namespace, states) => {
  const res = {}
  if (process.env.NODE_ENV !== 'production' && !isValidMap(states)) {
    console.error(
      '[vuex] mapState: mapper parameter must be either an Array or an Object'
    )
  }
  // ! states： [1, 2, 3] => [{ key: 1, val: 1 }, { key: 2, val: 2 }, { key: 3, val: 3 }]
  // ! states： {a:1, b:2, c:3} => [{ key: a, val: 1 }, { key: b, val: 2 }, { key: c, val: 3 }]
  normalizeMap(states).forEach(({ key, val }) => {
    res[key] = function mappedState() {
      // ! 获取 root 上的值
      let state = this.$store.state
      let getters = this.$store.getters
      // ! 如果设置了命名空间，即 mapXXX(namespace, ['name1', 'name2'])
      // ! 获取命名空间模块的值，即 store.xxx.name1 -> store.xxx[namespace/name1]
      if (namespace) {
        const module = getModuleByNamespace(this.$store, 'mapState', namespace) // ! 通过命名空间获取对应模块
        if (!module) {
          return
        }
        state = module.context.state // ! 在模块中获取值
        getters = module.context.getters
      }
      return typeof val === 'function' // ! 判断是否是函数
        ? val.call(this, state, getters) // ! val(state, getters)
        : state[val] // ! 返回 state 中对应的值即可
    }
    // mark vuex getter for devtools
    res[key].vuex = true
  })
  return res
})

/**
 * Reduce the code which written in Vue.js for committing the mutation
 * @param {String} [namespace] - Module's namespace
 * @param {Object|Array} mutations # Object's item can be a function which accept `commit` function as the first param, it can accept anthor params. You can commit mutation and do any other things in this function. specially, You need to pass anthor params from the mapped function.
 * @return {Object}
 */
export const mapMutations = normalizeNamespace((namespace, mutations) => {
  const res = {}
  if (process.env.NODE_ENV !== 'production' && !isValidMap(mutations)) {
    console.error(
      '[vuex] mapMutations: mapper parameter must be either an Array or an Object'
    )
  }
  normalizeMap(mutations).forEach(({ key, val }) => {
    res[key] = function mappedMutation(...args) {
      // Get the commit method from store
      let commit = this.$store.commit // ! 根的 commit
      if (namespace) {
        // ! 获取模块
        const module = getModuleByNamespace(
          this.$store,
          'mapMutations',
          namespace
        )
        if (!module) {
          return
        }
        commit = module.context.commit // ! 模块的 commit
      }
      return typeof val === 'function'
        ? val.apply(this, [commit].concat(args)) // ! 调用这个函数 val(commit, args)，函数传入 commit，在函数体中可以使用 commit 来提交 mutation
        : commit.apply(this.$store, [val].concat(args)) // ! string 形式 --> this.$store.commit(val, args)
    }
  })
  return res
})

/**
 * Reduce the code which written in Vue.js for getting the getters
 * @param {String} [namespace] - Module's namespace
 * @param {Object|Array} getters
 * @return {Object}
 */
export const mapGetters = normalizeNamespace((namespace, getters) => {
  const res = {}
  if (process.env.NODE_ENV !== 'production' && !isValidMap(getters)) {
    console.error(
      '[vuex] mapGetters: mapper parameter must be either an Array or an Object'
    )
  }
  normalizeMap(getters).forEach(({ key, val }) => {
    // The namespace has been mutated by normalizeNamespace
    val = namespace + val // ! moduleName/getterName
    res[key] = function mappedGetter() {
      if (
        namespace &&
        !getModuleByNamespace(this.$store, 'mapGetters', namespace)
      ) {
        return
      }
      if (
        process.env.NODE_ENV !== 'production' &&
        !(val in this.$store.getters)
      ) {
        console.error(`[vuex] unknown getter: ${val}`)
        return
      }
      return this.$store.getters[val] // ! 根据拼接后的 val 从实例属性 getters 获取对应的值
    }
    // mark vuex getter for devtools
    res[key].vuex = true
  })
  return res
})

/**
 * Reduce the code which written in Vue.js for dispatch the action
 * @param {String} [namespace] - Module's namespace
 * @param {Object|Array} actions # Object's item can be a function which accept `dispatch` function as the first param, it can accept anthor params. You can dispatch action and do any other things in this function. specially, You need to pass anthor params from the mapped function.
 * @return {Object}
 */
export const mapActions = normalizeNamespace((namespace, actions) => {
  const res = {}
  if (process.env.NODE_ENV !== 'production' && !isValidMap(actions)) {
    console.error(
      '[vuex] mapActions: mapper parameter must be either an Array or an Object'
    )
  }
  normalizeMap(actions).forEach(({ key, val }) => {
    res[key] = function mappedAction(...args) {
      // get dispatch function from store
      let dispatch = this.$store.dispatch
      if (namespace) {
        const module = getModuleByNamespace(
          this.$store,
          'mapActions',
          namespace
        )
        if (!module) {
          return
        }
        dispatch = module.context.dispatch
      }
      return typeof val === 'function'
        ? val.apply(this, [dispatch].concat(args))
        : dispatch.apply(this.$store, [val].concat(args))
    }
  })
  return res
})

/**
 * Rebinding namespace param for mapXXX function in special scoped, and return them by simple object
 * @param {String} namespace
 * @return {Object}
 */
export const createNamespacedHelpers = namespace => ({
  mapState: mapState.bind(null, namespace),
  mapGetters: mapGetters.bind(null, namespace),
  mapMutations: mapMutations.bind(null, namespace),
  mapActions: mapActions.bind(null, namespace)
})

/**
 * Normalize the map
 * normalizeMap([1, 2, 3]) => [ { key: 1, val: 1 }, { key: 2, val: 2 }, { key: 3, val: 3 } ]
 * normalizeMap({a: 1, b: 2, c: 3}) => [ { key: 'a', val: 1 }, { key: 'b', val: 2 }, { key: 'c', val: 3 } ]
 * @param {Array|Object} map
 * @return {Object}
 * ! 规范化 Map 👆
 */
function normalizeMap(map) {
  if (!isValidMap(map)) {
    return []
  }
  return Array.isArray(map)
    ? map.map(key => ({ key, val: key })) // ! 不修改 key 的名字
    : Object.keys(map).map(key => ({ key, val: map[key] })) // ! 映射，修改 key的名字
}

/**
 * Validate whether given map is valid or not
 * @param {*} map
 * @return {Boolean}
 */
function isValidMap(map) {
  return Array.isArray(map) || isObject(map)
}

/**
 * Return a function expect two param contains namespace and map. it will normalize the namespace and then the param's function will handle the new namespace and the map.
 * @param {Function} fn
 * @return {Function}
 * ! 处理 mapXXX 的参数 HOF
 */
function normalizeNamespace(fn) {
  return (namespace, map) => {
    // ! 命名空间不为字符串。
    // ! 比如，传入 root 的值时，没有模块名，是直接传 { a: mutationName } 或者 [ mutationName ]
    if (typeof namespace !== 'string') {
      map = namespace // ! 把命名空间设置为 map
      namespace = '' // ! 命名空间为空
      // ! 命名空间没有以 / 结尾时，拼接 / => moduleName = moduleName/
      // ! 模块名和 type 之间需要使用 / 隔开
    } else if (namespace.charAt(namespace.length - 1) !== '/') {
      namespace += '/'
    }
    return fn(namespace, map)
  }
}

/**
 * Search a special module from store by namespace. if module not exist, print error message.
 * @param {Object} store
 * @param {String} helper
 * @param {String} namespace
 * @return {Object}
 * ! 通过命名空间获取模块
 */
function getModuleByNamespace(store, helper, namespace) {
  const module = store._modulesNamespaceMap[namespace]
  if (process.env.NODE_ENV !== 'production' && !module) {
    console.error(
      `[vuex] module namespace not found in ${helper}(): ${namespace}`
    )
  }
  return module
}
