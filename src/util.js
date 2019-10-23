/**
 * Get the first item that pass the test
 * by second argument function
 * ! 查找数组中符合条件的第一个值
 * @param {Array} list
 * @param {Function} f
 * @return {*}
 */
export function find(list, f) {
  return list.filter(f)[0]
}

/**
 * Deep copy the given object considering circular structure.
 * This function caches all nested objects and its copies.
 * If it detects circular structure, use cached copy to avoid infinite loop.
 * ! 深度拷贝
 * @param {*} obj
 * @param {Array<Object>} cache
 * @return {*}
 */
export function deepCopy(obj, cache = []) {
  // just return if obj is immutable value
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  // if obj is hit, it is in circular structure
  const hit = find(cache, c => c.original === obj) // ! 获取缓存
  if (hit) {
    return hit.copy
  }

  const copy = Array.isArray(obj) ? [] : {}
  // put the copy into cache at first
  // because we want to refer it in recursive deepCopy
  // ! 缓存数据
  cache.push({
    original: obj,
    copy
  })

  Object.keys(obj).forEach(key => {
    copy[key] = deepCopy(obj[key], cache) // ! 递归
  })

  return copy
}

/**
 * forEach for object
 * ! 使用函数处理对象的所有 value 和 key
 */
export function forEachValue(obj, fn) {
  Object.keys(obj).forEach(key => fn(obj[key], key))
}

// ! 判断是否是一个对象类型（非 null）
export function isObject(obj) {
  return obj !== null && typeof obj === 'object'
}

// ! 判断是否是 Promise 对象
export function isPromise(val) {
  return val && typeof val.then === 'function'
}

// ! 断言：当条件没达成的时候，抛出错误
export function assert(condition, msg) {
  if (!condition) throw new Error(`[vuex] ${msg}`)
}

// ! 创建部分应用函数
export function partial(fn, arg) {
  return function() {
    return fn(arg)
  }
}
