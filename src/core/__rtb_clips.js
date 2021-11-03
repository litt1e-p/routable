export default {
  _gen: function (bit = 32) {
    return this._ren((new Date().getTime()).toString(bit))
  },
  _ren: function (s) {
    if (!s || !s.length) {
      return s
    }
    let o = s.split(''), r = []
    while(o.length) {
      let t = o.shift()
      r.unshift(Math.random() > 0.6 ? t.toUpperCase() : t)
    }
    return r.join('')
  },
  _enc: function (px, d, j = '.') {
    return px + d.split('').reverse().join(j)
  },
  _dec: function (px, qy, j = '.') {
    return px + this._enb(qy.slice(px.length).split(j).reverse().join(''))
  },
  _enp: function (args) {
    return btoa(encodeURIComponent(JSON.stringify(args)))
  },
  _dep: function (args) {
    return JSON.parse(decodeURIComponent(atob(args)))
  },
  _enb: function (s) {
    return btoa(s)
  },
  _deb: function (s) {
    return atob(s)
  }
}