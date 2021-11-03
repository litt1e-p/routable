<script>

import __rtb_dbs from './__rtb_dbs.js'
import __rtb_clips from './__rtb_clips.js'
import fromEntries from './__rtb.polyfill.js'
import 'url-polyfill'

export default {
  name: 'litt1epRoutable',
  methods: {
    __rtb_set (k, v) {
      return __rtb_dbs.__rtb_setSS.apply(this, [k, v])
    },
    __rtb_get (k) {
      return __rtb_dbs.__rtb_getSS.call(this, k)
    },
    __rtb_erased (args, c = false, px = 'sl,', qy = 'gs_l') {
      if (!args || args.length <= 0) {
        return ''
      }
      if (!c) {
        let o = Object.prototype.constructor()
        o[qy] = btoa(encodeURIComponent(JSON.stringify(args)))
        return o
      }
      let rd = new Date().getTime()
      let r = rd.toString().split('').reverse().join(',')
      let rc = r.substr(0, r.length - 4)
      this.__rtb_set(px + btoa(rc), btoa(encodeURIComponent(JSON.stringify(args))))
      let o = Object.prototype.constructor()
      o[qy] = px + btoa((rd * 0xFFFFFF << 7).toString(16)).split('').reverse().join('.') + ':' + rc
      return o
    },
    __rtb_erase (args, c = false, bit = 32, px = 'sl,', qy = 'gs_l') {
      if (!args || args.length <= 0) {
        return ''
      }
      if (!c) {
        let o = Object.prototype.constructor()
        o[qy] = __rtb_clips._enp(args)
        return o
      }
      const rcb = __rtb_clips._gen(bit)
      this.__rtb_set(px + __rtb_clips._enb(rcb), __rtb_clips._enp(args))
      let o = Object.prototype.constructor()
      o[qy] = __rtb_clips._enc(px, rcb)
      return o
    },
    async __rtb_record (args, c = false, px = 'sl,', qy = 'gs_l') {
      if (
        !args ||
        Object.keys(args).length <= 0 ||
        !args.hasOwnProperty(qy)
      ) {
        return {}
      }
      if (!c) {
        return __rtb_clips._dep(args[qy])
      }
      if (!args[qy].includes(px)) {
        return {}
      }
      let s = await __rtb_dbs.__rtb_getSS(__rtb_clips._dec(px, args[qy])).catch(e => {
        return false
      })
      if (!s) {
        return {}
      }
      return  __rtb_clips._dep(s)
    },
    async __rtb_flush (args, px = 'sl,', qy = 'gs_l') {
      let rs = false
      let k = args && args.hasOwnProperty(qy)
      let s = k ? args[qy] : void 0
      if (!s) {
        return rs
      }
      let sa = await __rtb_dbs.__rtb_ssKeys()
      let sl = sa.length
      if (!sl) {
        return rs
      }
      for (let i = 0; i < sl; i++) {
        const e = sa[i]
        if (s && this.__preProf(e) && e === __rtb_clips._dec(px, s)) {
          __rtb_dbs.__rtb_delSS(e)
          rs = true
          break
        }
      }
      return rs
    },
    async __rtb_clear (exception = '', px = 'sl,', qy = 'gs_l') {
      let sa = await __rtb_dbs.__rtb_ssKeys()
      let sl = sa.length
      let rs = true
      if (!sl) {
        return rs
      }
      let b = exception ? await __rtb_dbs.__rtb_getSS(exception) : ''
      let m
      if (b) {
        const q = await this.__rtb_route(b)
        if (q.hasOwnProperty('query') && q['query'].hasOwnProperty(qy)) {
          m = __rtb_clips._dec(px, q['query'][qy])
        }
      }
      for (let i = 0; i < sl; i++) {
        const e = sa[i]
        if (this.__preProf(e) && m !== e) {
          __rtb_dbs.__rtb_delSS(e)
        }
      }
      return true
    },
    __preProf (s, px = 'sl,') {
      return Object.prototype.toString.call(s) === '[object String]' && s.length >= 3 && s.slice(0, 3) === px
    },
    async __rtb_allKeys () {
      return await __rtb_dbs.__rtb_ssKeys()
    },
    async __rtb_allVals () {
      return await __rtb_dbs.__rtb_ssVals()
    },
    __rtb_route (u = '') {
      return new Promise((resolve, reject) => {
        if (!u || typeof u !== 'string') {
          return reject(new Error('Invalid __rtb_route params'))
        }
        if ('URLSearchParams' in window) {
          const url = new URL(u)
          const pas = fromEntries(new URLSearchParams(url.search))
          const path = url.pathname
          const query = pas
          return resolve({path, query})
        } else {
          return reject(new Error('Browser does not supports URLSearchParams'))
        }
      })
    }
  }
}

</script>