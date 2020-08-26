import { storeKey } from './injectKey'

export default function (app, store, injectKey) {
  app.provide(injectKey || storeKey, store) // ! provide store

  app.mixin({
    beforeCreate () {
      if (!this.parent) {
        // ! 把用户定义的 store 实例赋值给 Vue 实例的 $store 属性，方便组件操作 store
        this.$store = typeof store === 'function' ? store() : store
      } else {
        this.$store = this.parent.$options.$store // ! 从父组件中获取 store，因为全局的 store 都是同一个
      }
    }
  })
}
