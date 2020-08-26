const target = typeof window !== 'undefined'
  ? window
  : typeof global !== 'undefined'
    ? global
    : {}
const devtoolHook = target.__VUE_DEVTOOLS_GLOBAL_HOOK__ // ! 获取浏览器插件

export default function devtoolPlugin (store) {
  if (!devtoolHook) return

  store._devtoolHook = devtoolHook // ! 存储到 store 实例的 _devtoolHook 属性中

  devtoolHook.emit('vuex:init', store) // ! 派发初始化事件，传入 store 实例对象

  // ! 监听 Vuex 的 travel-to-state 事件，获取新值并替换 state
  devtoolHook.on('vuex:travel-to-state', targetState => {
    store.replaceState(targetState)
  })

  // ! 订阅 mutation，派发 Vuex 的 mutation 事件，传入 mutation 和 state
  store.subscribe((mutation, state) => {
    devtoolHook.emit('vuex:mutation', mutation, state)
  }, { prepend: true })

  // ! 订阅 action，派发 Vuex 的 action 事件，传入 action 和 state
  store.subscribeAction((action, state) => {
    devtoolHook.emit('vuex:action', action, state)
  }, { prepend: true })
}
