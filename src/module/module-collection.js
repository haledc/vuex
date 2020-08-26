import Module from './module'
import { assert, forEachValue } from '../util'

// ! 模块收集类，设置 root 模块
export default class ModuleCollection {
  constructor (rawRootModule) {
    // register root module (Vuex.Store options)
    this.register([], rawRootModule, false) // ! 初始化时注册模块
  }

  // ! 获取模块
  // ! 从根模块开始不停的获取它的子模块，直到路径数组解析完毕
  get (path) {
    return path.reduce((module, key) => {
      return module.getChild(key)
    }, this.root)
  }

  // ! 获取命名空间模块的名称
  getNamespace (path) {
    let module = this.root
    return path.reduce((namespace, key) => {
      module = module.getChild(key)
      return namespace + (module.namespaced ? key + '/' : '')
    }, '')
  }

  // ! 更新模块
  update (rawRootModule) {
    update([], this.root, rawRootModule)
  }

  // ! 注册模块
  register (path, rawModule, runtime = true) {
    if (__DEV__) {
      assertRawModule(path, rawModule)
    }

    const newModule = new Module(rawModule, runtime) // ! 创建一个模块
    if (path.length === 0) {
      this.root = newModule // ! 创建根模块 注意：this.root 是类唯一的属性值
    } else {
      const parent = this.get(path.slice(0, -1)) // ! 根据路径获取到父模块（在数组里面它前面的元素）
      parent.addChild(path[path.length - 1], newModule) // ! 添加子模块，建立父子关系
    }

    // register nested modules
    if (rawModule.modules) {
      forEachValue(rawModule.modules, (rawChildModule, key) => {
        this.register(path.concat(key), rawChildModule, runtime)
      })
    }
  }

  // ! 注销模块
  unregister (path) {
    const parent = this.get(path.slice(0, -1))
    const key = path[path.length - 1]
    const child = parent.getChild(key)

    if (!child) {
      if (__DEV__) {
        console.warn(
          `[vuex] trying to unregister module '${key}', which is ` +
          `not registered`
        )
      }
      return
    }

    if (!child.runtime) {
      return
    }

    parent.removeChild(key)
  }

  // ! 查询模块是否注册
  isRegistered (path) {
    const parent = this.get(path.slice(0, -1))
    const key = path[path.length - 1]

    return parent.hasChild(key)
  }
}

// ! 模块更新的方法
function update (path, targetModule, newModule) {
  if (__DEV__) {
    assertRawModule(path, newModule)
  }

  // update target module
  targetModule.update(newModule)

  // update nested modules
  if (newModule.modules) {
    for (const key in newModule.modules) {
      if (!targetModule.getChild(key)) {
        if (__DEV__) {
          console.warn(
            `[vuex] trying to add a new module '${key}' on hot reloading, ` +
            'manual reload is needed'
          )
        }
        return
      }
      update(
        path.concat(key),
        targetModule.getChild(key),
        newModule.modules[key]
      )
    }
  }
}

// ! 函数断言类型
const functionAssert = {
  assert: value => typeof value === 'function',
  expected: 'function'
}

// ! 对象断言类型（包括函数）
const objectAssert = {
  assert: value => typeof value === 'function' ||
    (typeof value === 'object' && typeof value.handler === 'function'),
  expected: 'function or object with "handler" function'
}

// ! 断言类型
const assertTypes = {
  getters: functionAssert, // ! getter 只能是函数类型
  mutations: functionAssert, // ! mutation 只能是函数类型
  actions: objectAssert // ! action 可以是函数也可以是含有 handler 函数的对象
}

// ! 断言原生数据
function assertRawModule (path, rawModule) {
  Object.keys(assertTypes).forEach(key => {
    if (!rawModule[key]) return

    const assertOptions = assertTypes[key]

    // ! 遍历原始数据对应 key 的选项，然后进行断言
    // ! 比如遍历 getters，判断每个 getter 的类型是不是函数
    forEachValue(rawModule[key], (value, type) => {
      assert(
        assertOptions.assert(value),
        makeAssertionMessage(path, key, type, value, assertOptions.expected)
      )
    })
  })
}

// ! 生成错误信息的方法
// ! e.g. getters should be function but getters.value in module xx/yy is {xxx: yyy}
function makeAssertionMessage (path, key, type, value, expected) {
  let buf = `${key} should be ${expected} but "${key}.${type}"`
  if (path.length > 0) {
    buf += ` in module "${path.join('.')}"`
  }
  buf += ` is ${JSON.stringify(value)}.`
  return buf
}
