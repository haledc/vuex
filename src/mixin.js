// ! mixin 方法
export default function(Vue) {
  const version = Number(Vue.version.split('.')[0]) // ! 获取版本号

  if (version >= 2) {
    Vue.mixin({ beforeCreate: vuexInit }) // ! 使用 Vue 的 mixin 混入 beforeCreate 钩子，初始化 Vuex
  } else {
    // override init and inject vuex init procedure
    // for 1.x backwards compatibility.
    // ! 兼容 v1.0 版本
    const _init = Vue.prototype._init
    Vue.prototype._init = function(options = {}) {
      options.init = options.init ? [vuexInit].concat(options.init) : vuexInit
      _init.call(this, options)
    }
  }

  /**
   * Vuex init hook, injected into each instances init hooks list.
   */

  // ! 初始化的方法
  function vuexInit() {
    const options = this.$options // ! 获取 Vue 实例的配置

    // store injection
    // ! 赋值给 Vue 组件实例的 $store
    if (options.store) {
      this.$store =
        typeof options.store === 'function' ? options.store() : options.store
    } else if (options.parent && options.parent.$store) {
      this.$store = options.parent.$store
    }
  }
}
