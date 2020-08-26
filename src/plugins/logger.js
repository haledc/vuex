// Credits: borrowed code from fcomb/redux-logger

import { deepCopy } from '../util'

export function createLogger ({
  collapsed = true, // ! 默认折叠
  filter = (mutation, stateBefore, stateAfter) => true, // ! 筛选 mutation 和 state 函数
  transformer = state => state, // ! 处理数据的函数
  mutationTransformer = mut => mut, // ! 处理 mutation 的函数
  actionFilter = (action, state) => true, // ! action 筛选函数
  actionTransformer = act => act, // ! 处理 action 的函数
  logMutations = true, // ! 是否打印 mutation 信息
  logActions = true, // ! 是否打印 action 信息
  logger = console
} = {}) {
  return store => {
    let prevState = deepCopy(store.state) // ! 深拷贝旧的数据

    if (typeof logger === 'undefined') {
      return
    }

    if (logMutations) {
      // ! 订阅 mutation
      store.subscribe((mutation, state) => {
        const nextState = deepCopy(state) // ! 深拷贝新的数据（mutation 后的数据）

        if (filter(mutation, prevState, nextState)) {
          const formattedTime = getFormattedTime() // ! 格式化后的当前时间
          const formattedMutation = mutationTransformer(mutation) // ! 处理后的 mutation 数据
          const message = `mutation ${mutation.type}${formattedTime}`

          startMessage(logger, message, collapsed)
          logger.log('%c prev state', 'color: #9E9E9E; font-weight: bold', transformer(prevState))
          logger.log('%c mutation', 'color: #03A9F4; font-weight: bold', formattedMutation)
          logger.log('%c next state', 'color: #4CAF50; font-weight: bold', transformer(nextState))
          endMessage(logger)
        }

        prevState = nextState // ! 每次都更新数据（新数据变旧数据）
      })
    }

    if (logActions) {
      store.subscribeAction((action, state) => {
        if (actionFilter(action, state)) {
          const formattedTime = getFormattedTime() // ! 格式化后的当前时间
          const formattedAction = actionTransformer(action) // ! 处理后的 action 数据
          const message = `action ${action.type}${formattedTime}`

          startMessage(logger, message, collapsed)
          logger.log('%c action', 'color: #03A9F4; font-weight: bold', formattedAction)
          endMessage(logger)
        }
      })
    }
  }
}

function startMessage (logger, message, collapsed) {
  const startMessage = collapsed
    ? logger.groupCollapsed
    : logger.group

  // render
  try {
    startMessage.call(logger, message)
  } catch (e) {
    logger.log(message)
  }
}

function endMessage (logger) {
  try {
    logger.groupEnd()
  } catch (e) {
    logger.log('—— log end ——')
  }
}

function getFormattedTime () {
  const time = new Date()
  return ` @ ${pad(time.getHours(), 2)}:${pad(time.getMinutes(), 2)}:${pad(time.getSeconds(), 2)}.${pad(time.getMilliseconds(), 3)}`
}

function repeat (str, times) {
  return (new Array(times + 1)).join(str)
}

function pad (num, maxLength) {
  return repeat('0', maxLength - num.toString().length) + num
}
