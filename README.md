# Routable

link tool of vue2.x router which maybe exists mess query params
> [vue 3.x supports](https://github.com/litt1e-p/routable/tree/next)

## Installation

```
npm i @litt1e-p/routable

import Routable from '@litt1e-p/routable'
Vue.use(Routable)
// or
import { Routable } from '@litt1e-p/routable'
mixins: [Routable]
```

## Usage


- `__rtb_erase`
  ```
  this.__rtb_erase((args, c = false, px = 'sl,', qy = 'gs_l'))
  eg. to erase query params
  this.__rtb_erase({
    dto: encodeURIComponent(JSON.stringify({a: 1, b: 'xx'}))
  })
  // output: 'gs_l=JTdCJTIyZHRvJTIyJTNBJTIyJTI1N0IlMjUyMmElMjUyMiUyNTNBMSUyNTJDJTI1MjJiJTI1MjIlMjUzQSUyNTIyeHglMjUyMiUyNTdEJTIyJTdE'
  // or
  this.__rtb_erase({
    dto: encodeURIComponent(JSON.stringify({a: 1, b: 'xx'}))
  }, true)
  // output: 'gs_l=sl,1.e.B.F.U.q.9.4.c'
  ```
- `__rtb_record`
  ```
  this.__rtb_record(args, c = false, px = 'sl,', qy = 'gs_l')
  eg. to record query params
  this.__rtb_record({gs_l: JTdCJTIyZHRvJTIyJTNBJTIyJTI1N0IlMjUyMmElMjUyMiUyNTNBMSUyNTJDJTI1MjJiJTI1MjIlMjUzQSUyNTIyeHglMjUyMiUyNTdEJTIyJTdE})
  // output: {a: 1, b: 'xx'}
  // or
  this.__rtb_record({gs_l: 'sl,1.e.B.F.U.q.9.4.c'}, true)
  output: {a: 1, b: 'xx'}
  ```
- `__rtb_flush`
  ```
  eg. flush a key
  this.__rtb_flush({gs_l: 'sl,1.e.B.F.U.q.9.4.c'})
  ```
- `__rtb_clear`
  ```
  eg. not only clear all keys but also keep some exception keys
  this.__rtb_clear('exception key')
  ```
- `__rtb_set`: store key-values
  ```
  this.__rtb_set('key', 'value')
  ```
  
- `__rtb_get`: get values for stored keys
   ```
  this.__rtb_get('key')
  // output: 'value'
  ```
