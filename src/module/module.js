import { forEachValue } from '../util'

// Base data struct for store's module, package with some attribute and method
// ! 模块类
export default class Module {
  constructor(rawModule, runtime) {
    this.runtime = runtime // ! 存储 runtime 的值
    // Store some children item
    this._children = Object.create(null) // ! 存储子模块
    // Store the origin module object which passed by programmer
    this._rawModule = rawModule // ! 存储原始模块数据
    const rawState = rawModule.state // ! 获取根的 state 原始数据

    // Store the origin module's state
    this.state = (typeof rawState === 'function' ? rawState() : rawState) || {} // ! 存储 state
  }

  // ! 获取命名空间的值 true or false
  get namespaced() {
    return !!this._rawModule.namespaced
  }

  // ! 增加子模块
  addChild(key, module) {
    this._children[key] = module
  }

  // ! 增加子模块
  removeChild(key) {
    delete this._children[key]
  }

  // ! 获取子模块
  getChild(key) {
    return this._children[key]
  }

  // ! 更新原始数据，保存到 _rawModule 属性中 => 更新 actions mutations getters
  update(rawModule) {
    this._rawModule.namespaced = rawModule.namespaced
    if (rawModule.actions) {
      this._rawModule.actions = rawModule.actions
    }
    if (rawModule.mutations) {
      this._rawModule.mutations = rawModule.mutations
    }
    if (rawModule.getters) {
      this._rawModule.getters = rawModule.getters
    }
  }

  // ! 遍历并处理子模块
  forEachChild(fn) {
    forEachValue(this._children, fn)
  }

  // ! 遍历并处理 getters
  forEachGetter(fn) {
    if (this._rawModule.getters) {
      forEachValue(this._rawModule.getters, fn)
    }
  }

  // ! 遍历并处理 actions
  forEachAction(fn) {
    if (this._rawModule.actions) {
      forEachValue(this._rawModule.actions, fn)
    }
  }

  // ! 遍历并处理 mutations
  forEachMutation(fn) {
    if (this._rawModule.mutations) {
      forEachValue(this._rawModule.mutations, fn)
    }
  }
}
