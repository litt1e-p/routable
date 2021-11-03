# Routable

link tool of vue3.x router which maybe exists mess query params
> [vue 2.x supports](https://github.com/litt1e-p/routable)

## Installation

```
npm i @litt1e-p/routable@next

import Routable from '@litt1e-p/routable'

// or
import { __rtb_erase, __rtb_record, __rtb_flush, __rtb_clear, __rtb_set, __rtb_get, __rtb_allKeys, __rtb_allVals, __rtb_route } from '@litt1e-p/routable'

```
## Usage

- `__rtb_erase`
  ```
  __rtb_erase((args, c = false, px = 'sl,', qy = 'gs_l'))
  eg. to erase query params
  __rtb_erase({
    dto: encodeURIComponent(JSON.stringify({a: 1, b: 'xx'}))
  })
  // output: 'gs_l=JTdCJTIyZHRvJTIyJTNBJTIyJTI1N0IlMjUyMmElMjUyMiUyNTNBMSUyNTJDJTI1MjJiJTI1MjIlMjUzQSUyNTIyeHglMjUyMiUyNTdEJTIyJTdE'
  // or
  __rtb_erase({
    dto: encodeURIComponent(JSON.stringify({a: 1, b: 'xx'}))
  }, true)
  // output: 'gs_l=sl,1.e.B.F.U.q.9.4.c'
  ```
- `__rtb_record`
  ```
  __rtb_record(args, c = false, px = 'sl,', qy = 'gs_l')
  eg. to record query params
  __rtb_record({gs_l: JTdCJTIyZHRvJTIyJTNBJTIyJTI1N0IlMjUyMmElMjUyMiUyNTNBMSUyNTJDJTI1MjJiJTI1MjIlMjUzQSUyNTIyeHglMjUyMiUyNTdEJTIyJTdE})
  // output: {a: 1, b: 'xx'}
  // or
  __rtb_record({gs_l: 'sl,1.e.B.F.U.q.9.4.c'}, true)
  output: {a: 1, b: 'xx'}
  ```
- `__rtb_flush`
  ```
  eg. flush a key
  __rtb_flush({gs_l: 'sl,1.e.B.F.U.q.9.4.c'})
  ```
- `__rtb_clear`
  ```
  eg. not only clear all keys but also keep some exception keys
  __rtb_clear('exception key')
  ```
- `__rtb_set`: store key-values
  ```
  __rtb_set('key', 'value')
  ```
  
- `__rtb_get`: get values for stored keys
   ```
  __rtb_get('key')
  // output: 'value'
  ```
