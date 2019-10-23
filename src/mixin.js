// ! mixin 方法
export default function(Vue) {
  const version = Number(Vue.version.split('.')[0]) // ! 获取主版本号

  if (version >= 2) {
    Vue.mixin({ beforeCreate: vuexInit }) // ! 使用 Vue 的 mixin 方法把 vuexInit 混入到 beforeCreate 钩子中
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

  // ! Vuex 初始化方法
  function vuexInit() {
    const options = this.$options // ! 获取 Vue 实例的选项

    // store injection
    if (options.store) {
      // ! 把用户定义的 store 实例赋值给 Vue 实例的 $store 属性，方便组件操作 store
      this.$store =
        typeof options.store === 'function' ? options.store() : options.store
    } else if (options.parent && options.parent.$store) {
      this.$store = options.parent.$store // ! 从父组件中获取 store，因为全局的 store 都是同一个
    }
  }
}
