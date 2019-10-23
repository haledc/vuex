import Module from './module'
import { assert, forEachValue } from '../util'

// ! 模块收集类，设置 root 模块
export default class ModuleCollection {
  constructor(rawRootModule) {
    // register root module (Vuex.Store options)
    this.register([], rawRootModule, false) // ! 初始化时注册模块
  }

  // ! 获取模块
  // ! 从根模块开始不停的获取它的子模块，直到路径数组解析完毕
  get(path) {
    return path.reduce((module, key) => {
      return module.getChild(key)
    }, this.root)
  }

  // ! 获取命名空间模块的名称
  getNamespace(path) {
    let module = this.root // ! 获取根模块
    return path.reduce((namespace, key) => {
      module = module.getChild(key) // ! 获取子模块

      // ! 子模块 key 设置了命名空间，获取 key，并且拼接 '/'
      // ! 第一轮循环：path = [ moduleName ]，namespace = ''，key = moduleName =>  'moduleName/'
      return namespace + (module.namespaced ? key + '/' : '')
    }, '')
  }

  update(rawRootModule) {
    update([], this.root, rawRootModule)
  }

  /**
   * ! 模块注册
   * @param {Array<String>} path 构建树的过程中维护的路径
   * @param {Object} rawModule 模块的原始配置
   * @param {Boolean} runtime 是否是一个运行时创建的模块
   */
  register(path, rawModule, runtime = true) {
    // ! 开发模式下断言原始数据，判断输入的数据类型是否有错
    if (process.env.NODE_ENV !== 'production') {
      assertRawModule(path, rawModule)
    }

    const newModule = new Module(rawModule, runtime) // ! 创建一个模块

    // ! path 为空时
    if (path.length === 0) {
      this.root = newModule // ! 创建的模块为根模块，注意：this.root 是这里类唯一的属性值
    } else {
      const parent = this.get(path.slice(0, -1)) // ! 根据路径获取到父模块（在数组里面它前面的元素）
      parent.addChild(path[path.length - 1], newModule) // ! 添加子模块，建立父子关系
    }

    // register nested modules
    // ! 用户自定义模块，注册嵌套模块
    if (rawModule.modules) {
      forEachValue(rawModule.modules, (rawChildModule, key) => {
        // ! 把 key 放入到 path 中，key === moduleName
        this.register(path.concat(key), rawChildModule, runtime)
      })
    }
  }

  // ! 模块注销的方法
  unregister(path) {
    const parent = this.get(path.slice(0, -1))
    const key = path[path.length - 1]
    if (!parent.getChild(key).runtime) return

    parent.removeChild(key) // ! 移除子模块
  }
}

// ! 模块更新的方法
function update(path, targetModule, newModule) {
  if (process.env.NODE_ENV !== 'production') {
    assertRawModule(path, newModule)
  }

  // update target module
  targetModule.update(newModule)

  // update nested modules
  if (newModule.modules) {
    for (const key in newModule.modules) {
      if (!targetModule.getChild(key)) {
        if (process.env.NODE_ENV !== 'production') {
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

// ! 函数断言
const functionAssert = {
  assert: value => typeof value === 'function',
  expected: 'function'
}

// ! 函数或者对象断言
const objectAssert = {
  assert: value =>
    typeof value === 'function' ||
    (typeof value === 'object' && typeof value.handler === 'function'),
  expected: 'function or object with "handler" function'
}

// ! 类型断言
const assertTypes = {
  getters: functionAssert, // ! getter 只能是函数
  mutations: functionAssert, // ! mutation 只能是函数
  actions: objectAssert // ! action 可以是函数也可以是含有 handler 函数的对象
}

// ! 断言原始数据
function assertRawModule(path, rawModule) {
  Object.keys(assertTypes).forEach(key => {
    if (!rawModule[key]) return

    const assertOptions = assertTypes[key] // ! 获取选项的断言

    // ! 遍历原始数据对应 key 的选项，然后进行断言
    // ! 比如遍历 getters，判断每个 getter 的类型是不是函数
    forEachValue(rawModule[key], (value, type) => {
      assert(
        assertOptions.assert(value),
        makeAssertionMessage(path, key, type, value, assertOptions.expected) // ! 生成错误信息
      )
    })
  })
}

// ! 生成错误信息的方法
// ! e.g. getters should be function but getters.value in module xx/yy is {xxx: yyy}
function makeAssertionMessage(path, key, type, value, expected) {
  let buf = `${key} should be ${expected} but "${key}.${type}"`
  if (path.length > 0) {
    buf += ` in module "${path.join('.')}"`
  }
  buf += ` is ${JSON.stringify(value)}.`
  return buf
}
