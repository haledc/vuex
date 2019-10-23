// Credits: borrowed code from fcomb/redux-logger

import { deepCopy } from '../util'

export default function createLogger({
  collapsed = true, // ! 默认折叠
  filter = (mutation, stateBefore, stateAfter) => true, // ! 筛选 mutation 和 state 函数
  transformer = state => state, // ! 处理数据的函数
  mutationTransformer = mut => mut, // ! 处理 mutation 的函数
  logger = console
} = {}) {
  return store => {
    let prevState = deepCopy(store.state) // ! 深拷贝旧的数据

    // ! 订阅 mutation
    store.subscribe((mutation, state) => {
      if (typeof logger === 'undefined') {
        return
      }
      const nextState = deepCopy(state) // ! 深拷贝新的数据（mutation 后的数据）

      if (filter(mutation, prevState, nextState)) {
        const time = new Date() // ! 当前时间

        // ! 格式化时间 hour:minutes:second:millisecond
        const formattedTime = ` @ ${pad(time.getHours(), 2)}:${pad(
          time.getMinutes(),
          2
        )}:${pad(time.getSeconds(), 2)}.${pad(time.getMilliseconds(), 3)}`
        const formattedMutation = mutationTransformer(mutation) // ! 处理后的 mutation
        const message = `mutation ${mutation.type}${formattedTime}`
        const startMessage = collapsed ? logger.groupCollapsed : logger.group // ! 是否分组或者封装折叠打印

        // render
        try {
          startMessage.call(logger, message) // ! 分组或者封装折叠打印 message
        } catch (e) {
          console.log(message) // ! 普通打印
        }

        // ! 在控制台打印相关信息
        logger.log(
          '%c prev state',
          'color: #9E9E9E; font-weight: bold',
          transformer(prevState) // ! mutation 前的数据
        )
        logger.log(
          '%c mutation',
          'color: #03A9F4; font-weight: bold',
          formattedMutation // ! 处理后的 mutation 的信息，可以重写 mutationTransformer 函数来处理 mutation
        )
        logger.log(
          '%c next state',
          'color: #4CAF50; font-weight: bold',
          transformer(nextState) // ! mutation 后的数据
        )

        try {
          logger.groupEnd()
        } catch (e) {
          logger.log('—— log end ——')
        }
      }

      prevState = nextState // ! 每次都更新数据
    })
  }
}

function repeat(str, times) {
  return new Array(times + 1).join(str)
}

function pad(num, maxLength) {
  return repeat('0', maxLength - num.toString().length) + num
}
