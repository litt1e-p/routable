export default function fromEntries (iterable) {
  return typeof Object.fromEntries === 'function' ? Object.fromEntries(iterable) : [...iterable].reduce((obj, [key, val]) => {
    obj[key] = val
    return obj
  }, {})
}
