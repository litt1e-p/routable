function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) {
  try {
    var info = gen[key](arg);
    var value = info.value;
  } catch (error) {
    reject(error);
    return;
  }

  if (info.done) {
    resolve(value);
  } else {
    Promise.resolve(value).then(_next, _throw);
  }
}

function _asyncToGenerator(fn) {
  return function () {
    var self = this,
        args = arguments;
    return new Promise(function (resolve, reject) {
      var gen = fn.apply(self, args);

      function _next(value) {
        asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value);
      }

      function _throw(err) {
        asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err);
      }

      _next(undefined);
    });
  };
}

const instanceOfAny = (object, constructors) => constructors.some(c => object instanceof c);

let idbProxyableTypes;
let cursorAdvanceMethods; // This is a function to prevent it throwing up in node environments.

function getIdbProxyableTypes() {
  return idbProxyableTypes || (idbProxyableTypes = [IDBDatabase, IDBObjectStore, IDBIndex, IDBCursor, IDBTransaction]);
} // This is a function to prevent it throwing up in node environments.


function getCursorAdvanceMethods() {
  return cursorAdvanceMethods || (cursorAdvanceMethods = [IDBCursor.prototype.advance, IDBCursor.prototype.continue, IDBCursor.prototype.continuePrimaryKey]);
}

const cursorRequestMap = new WeakMap();
const transactionDoneMap = new WeakMap();
const transactionStoreNamesMap = new WeakMap();
const transformCache = new WeakMap();
const reverseTransformCache = new WeakMap();

function promisifyRequest(request) {
  const promise = new Promise((resolve, reject) => {
    const unlisten = () => {
      request.removeEventListener('success', success);
      request.removeEventListener('error', error);
    };

    const success = () => {
      resolve(wrap(request.result));
      unlisten();
    };

    const error = () => {
      reject(request.error);
      unlisten();
    };

    request.addEventListener('success', success);
    request.addEventListener('error', error);
  });
  promise.then(value => {
    // Since cursoring reuses the IDBRequest (*sigh*), we cache it for later retrieval
    // (see wrapFunction).
    if (value instanceof IDBCursor) {
      cursorRequestMap.set(value, request);
    } // Catching to avoid "Uncaught Promise exceptions"

  }).catch(() => {}); // This mapping exists in reverseTransformCache but doesn't doesn't exist in transformCache. This
  // is because we create many promises from a single IDBRequest.

  reverseTransformCache.set(promise, request);
  return promise;
}

function cacheDonePromiseForTransaction(tx) {
  // Early bail if we've already created a done promise for this transaction.
  if (transactionDoneMap.has(tx)) return;
  const done = new Promise((resolve, reject) => {
    const unlisten = () => {
      tx.removeEventListener('complete', complete);
      tx.removeEventListener('error', error);
      tx.removeEventListener('abort', error);
    };

    const complete = () => {
      resolve();
      unlisten();
    };

    const error = () => {
      reject(tx.error || new DOMException('AbortError', 'AbortError'));
      unlisten();
    };

    tx.addEventListener('complete', complete);
    tx.addEventListener('error', error);
    tx.addEventListener('abort', error);
  }); // Cache it for later retrieval.

  transactionDoneMap.set(tx, done);
}

let idbProxyTraps = {
  get(target, prop, receiver) {
    if (target instanceof IDBTransaction) {
      // Special handling for transaction.done.
      if (prop === 'done') return transactionDoneMap.get(target); // Polyfill for objectStoreNames because of Edge.

      if (prop === 'objectStoreNames') {
        return target.objectStoreNames || transactionStoreNamesMap.get(target);
      } // Make tx.store return the only store in the transaction, or undefined if there are many.


      if (prop === 'store') {
        return receiver.objectStoreNames[1] ? undefined : receiver.objectStore(receiver.objectStoreNames[0]);
      }
    } // Else transform whatever we get back.


    return wrap(target[prop]);
  },

  set(target, prop, value) {
    target[prop] = value;
    return true;
  },

  has(target, prop) {
    if (target instanceof IDBTransaction && (prop === 'done' || prop === 'store')) {
      return true;
    }

    return prop in target;
  }

};

function replaceTraps(callback) {
  idbProxyTraps = callback(idbProxyTraps);
}

function wrapFunction(func) {
  // Due to expected object equality (which is enforced by the caching in `wrap`), we
  // only create one new func per func.
  // Edge doesn't support objectStoreNames (booo), so we polyfill it here.
  if (func === IDBDatabase.prototype.transaction && !('objectStoreNames' in IDBTransaction.prototype)) {
    return function (storeNames, ...args) {
      const tx = func.call(unwrap(this), storeNames, ...args);
      transactionStoreNamesMap.set(tx, storeNames.sort ? storeNames.sort() : [storeNames]);
      return wrap(tx);
    };
  } // Cursor methods are special, as the behaviour is a little more different to standard IDB. In
  // IDB, you advance the cursor and wait for a new 'success' on the IDBRequest that gave you the
  // cursor. It's kinda like a promise that can resolve with many values. That doesn't make sense
  // with real promises, so each advance methods returns a new promise for the cursor object, or
  // undefined if the end of the cursor has been reached.


  if (getCursorAdvanceMethods().includes(func)) {
    return function (...args) {
      // Calling the original function with the proxy as 'this' causes ILLEGAL INVOCATION, so we use
      // the original object.
      func.apply(unwrap(this), args);
      return wrap(cursorRequestMap.get(this));
    };
  }

  return function (...args) {
    // Calling the original function with the proxy as 'this' causes ILLEGAL INVOCATION, so we use
    // the original object.
    return wrap(func.apply(unwrap(this), args));
  };
}

function transformCachableValue(value) {
  if (typeof value === 'function') return wrapFunction(value); // This doesn't return, it just creates a 'done' promise for the transaction,
  // which is later returned for transaction.done (see idbObjectHandler).

  if (value instanceof IDBTransaction) cacheDonePromiseForTransaction(value);
  if (instanceOfAny(value, getIdbProxyableTypes())) return new Proxy(value, idbProxyTraps); // Return the same value back if we're not going to transform it.

  return value;
}

function wrap(value) {
  // We sometimes generate multiple promises from a single IDBRequest (eg when cursoring), because
  // IDB is weird and a single IDBRequest can yield many responses, so these can't be cached.
  if (value instanceof IDBRequest) return promisifyRequest(value); // If we've already transformed this value before, reuse the transformed value.
  // This is faster, but it also provides object equality.

  if (transformCache.has(value)) return transformCache.get(value);
  const newValue = transformCachableValue(value); // Not all types are transformed.
  // These may be primitive types, so they can't be WeakMap keys.

  if (newValue !== value) {
    transformCache.set(value, newValue);
    reverseTransformCache.set(newValue, value);
  }

  return newValue;
}

const unwrap = value => reverseTransformCache.get(value);

/**
 * Open a database.
 *
 * @param name Name of the database.
 * @param version Schema version.
 * @param callbacks Additional callbacks.
 */

function openDB(name, version, {
  blocked,
  upgrade,
  blocking,
  terminated
} = {}) {
  const request = indexedDB.open(name, version);
  const openPromise = wrap(request);

  if (upgrade) {
    request.addEventListener('upgradeneeded', event => {
      upgrade(wrap(request.result), event.oldVersion, event.newVersion, wrap(request.transaction));
    });
  }

  if (blocked) request.addEventListener('blocked', () => blocked());
  openPromise.then(db => {
    if (terminated) db.addEventListener('close', () => terminated());
    if (blocking) db.addEventListener('versionchange', () => blocking());
  }).catch(() => {});
  return openPromise;
}

const readMethods = ['get', 'getKey', 'getAll', 'getAllKeys', 'count'];
const writeMethods = ['put', 'add', 'delete', 'clear'];
const cachedMethods = new Map();

function getMethod(target, prop) {
  if (!(target instanceof IDBDatabase && !(prop in target) && typeof prop === 'string')) {
    return;
  }

  if (cachedMethods.get(prop)) return cachedMethods.get(prop);
  const targetFuncName = prop.replace(/FromIndex$/, '');
  const useIndex = prop !== targetFuncName;
  const isWrite = writeMethods.includes(targetFuncName);

  if ( // Bail if the target doesn't exist on the target. Eg, getAll isn't in Edge.
  !(targetFuncName in (useIndex ? IDBIndex : IDBObjectStore).prototype) || !(isWrite || readMethods.includes(targetFuncName))) {
    return;
  }

  const method = async function (storeName, ...args) {
    // isWrite ? 'readwrite' : undefined gzipps better, but fails in Edge :(
    const tx = this.transaction(storeName, isWrite ? 'readwrite' : 'readonly');
    let target = tx.store;
    if (useIndex) target = target.index(args.shift());
    const returnVal = target[targetFuncName](...args);
    if (isWrite) await tx.done;
    return returnVal;
  };

  cachedMethods.set(prop, method);
  return method;
}

replaceTraps(oldTraps => ({ ...oldTraps,
  get: (target, prop, receiver) => getMethod(target, prop) || oldTraps.get(target, prop, receiver),
  has: (target, prop) => !!getMethod(target, prop) || oldTraps.has(target, prop)
}));

if (!('indexedDB' in window)) {
  throw new Error('fatal error: the browser does not support indexedDb');
}

var _dbName = '__rtb_db_routable';
var _tbName = '__rtb_db_table';

var _db = openDB(_dbName, 1, {
  upgrade(db) {
    db.createObjectStore(_tbName);
  }

}); // return openDB(_dbName, 1, db => {
//   if (!db.objectStoreNames.contains(_tbName)) {
//     const store = db.createObjectStore(_tbName, {
//       // The 'id' property of the object will be the key.
//       keyPath: 'id',
//       // If it isn't explicitly set, create a value by auto incrementing.
//       autoIncrement: true,
//     });
//     // Create an index on the 'id' property of the objects.
//     // store.createIndex('id', 'id');
//   }
// })
// }


var __rtb_utils = {
  __rtb_setSS(k, v) {
    return _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee() {
      return regeneratorRuntime.wrap(function _callee$(_context) {
        while (1) {
          switch (_context.prev = _context.next) {
            case 0:
              _context.next = 2;
              return _db;

            case 2:
              _context.next = 4;
              return _context.sent.put(_tbName, v, k);

            case 4:
              return _context.abrupt("return", _context.sent);

            case 5:
            case "end":
              return _context.stop();
          }
        }
      }, _callee);
    }))();
  },

  __rtb_getSS(k) {
    return _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee2() {
      return regeneratorRuntime.wrap(function _callee2$(_context2) {
        while (1) {
          switch (_context2.prev = _context2.next) {
            case 0:
              _context2.next = 2;
              return _db;

            case 2:
              _context2.next = 4;
              return _context2.sent.get(_tbName, k);

            case 4:
              return _context2.abrupt("return", _context2.sent);

            case 5:
            case "end":
              return _context2.stop();
          }
        }
      }, _callee2);
    }))();
  },

  __rtb_delSS(k) {
    return _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee3() {
      return regeneratorRuntime.wrap(function _callee3$(_context3) {
        while (1) {
          switch (_context3.prev = _context3.next) {
            case 0:
              _context3.next = 2;
              return _db;

            case 2:
              _context3.next = 4;
              return _context3.sent.delete(_tbName, k);

            case 4:
              return _context3.abrupt("return", _context3.sent);

            case 5:
            case "end":
              return _context3.stop();
          }
        }
      }, _callee3);
    }))();
  },

  __rtb_clearSS() {
    return _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee4() {
      return regeneratorRuntime.wrap(function _callee4$(_context4) {
        while (1) {
          switch (_context4.prev = _context4.next) {
            case 0:
              _context4.next = 2;
              return _db;

            case 2:
              _context4.next = 4;
              return _context4.sent.clear(_tbName);

            case 4:
              return _context4.abrupt("return", _context4.sent);

            case 5:
            case "end":
              return _context4.stop();
          }
        }
      }, _callee4);
    }))();
  },

  __rtb_ssKeys() {
    return _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee5() {
      return regeneratorRuntime.wrap(function _callee5$(_context5) {
        while (1) {
          switch (_context5.prev = _context5.next) {
            case 0:
              _context5.next = 2;
              return _db;

            case 2:
              _context5.next = 4;
              return _context5.sent.getAllKeys(_tbName);

            case 4:
              return _context5.abrupt("return", _context5.sent);

            case 5:
            case "end":
              return _context5.stop();
          }
        }
      }, _callee5);
    }))();
  }

};

var script = {
  name: '_@litt1e-p/routable',
  methods: {
    __rtb_set(k, v) {
      return __rtb_utils.__rtb_setSS.apply(this, [k, v]);
    },

    __rtb_get(k) {
      return __rtb_utils.__rtb_getSS.call(this, k);
    },

    __rtb_erase(args) {
      var c = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;
      var px = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 'sl,';
      var qy = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : 'gs_l';

      if (!args || args.length <= 0) {
        return '';
      }

      if (!c) {
        var _o = Object.prototype.constructor();

        _o[qy] = btoa(encodeURIComponent(JSON.stringify(args)));
        return _o;
      }

      var rd = new Date().getTime();
      var r = rd.toString().split('').reverse().join(',');
      var rc = r.substr(0, r.length - 4);

      this.__rtb_set(px + btoa(rc), btoa(encodeURIComponent(JSON.stringify(args)))); // __rtb_utils.__rtb_setSS(px + btoa(rc), btoa(encodeURIComponent(JSON.stringify(args))))


      var o = Object.prototype.constructor();
      o[qy] = px + btoa((rd * 0xFFFFFF << 7).toString(16)).split('').reverse().join('.') + ':' + rc;
      return o;
    },

    __rtb_record(args) {
      var _arguments = arguments;
      return _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee() {
        var c, px, l, qy, s;
        return regeneratorRuntime.wrap(function _callee$(_context) {
          while (1) {
            switch (_context.prev = _context.next) {
              case 0:
                c = _arguments.length > 1 && _arguments[1] !== undefined ? _arguments[1] : false;
                px = _arguments.length > 2 && _arguments[2] !== undefined ? _arguments[2] : 'sl,';
                l = _arguments.length > 3 && _arguments[3] !== undefined ? _arguments[3] : -21;
                qy = _arguments.length > 4 && _arguments[4] !== undefined ? _arguments[4] : 'gs_l';

                if (!(!args || Object.keys(args).length <= 0 || !args.hasOwnProperty(qy))) {
                  _context.next = 6;
                  break;
                }

                return _context.abrupt("return", {});

              case 6:
                if (c) {
                  _context.next = 8;
                  break;
                }

                return _context.abrupt("return", JSON.parse(decodeURIComponent(atob(args[qy]))));

              case 8:
                _context.next = 10;
                return __rtb_utils.__rtb_getSS(px + btoa(args[qy].slice(l))).catch(function (e) {
                  return false;
                });

              case 10:
                s = _context.sent;

                if (s) {
                  _context.next = 13;
                  break;
                }

                return _context.abrupt("return", {});

              case 13:
                return _context.abrupt("return", JSON.parse(decodeURIComponent(atob(s))));

              case 14:
              case "end":
                return _context.stop();
            }
          }
        }, _callee);
      }))();
    },

    __rtb_flush(args) {
      var _arguments2 = arguments;
      return _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee2() {
        var px, l, qy, sa, sl, rs, k, s, i, e;
        return regeneratorRuntime.wrap(function _callee2$(_context2) {
          while (1) {
            switch (_context2.prev = _context2.next) {
              case 0:
                px = _arguments2.length > 1 && _arguments2[1] !== undefined ? _arguments2[1] : 'sl,';
                l = _arguments2.length > 2 && _arguments2[2] !== undefined ? _arguments2[2] : -21;
                qy = _arguments2.length > 3 && _arguments2[3] !== undefined ? _arguments2[3] : 'gs_l';
                _context2.next = 5;
                return __rtb_utils.__rtb_ssKeys();

              case 5:
                sa = _context2.sent;
                sl = sa.length;
                rs = false;

                if (sl) {
                  _context2.next = 10;
                  break;
                }

                return _context2.abrupt("return", rs);

              case 10:
                k = args && args.hasOwnProperty(qy);
                s = k ? args[qy] : void 0;

                if (s) {
                  _context2.next = 14;
                  break;
                }

                return _context2.abrupt("return", rs);

              case 14:
                i = 0;

              case 15:
                if (!(i < sl)) {
                  _context2.next = 24;
                  break;
                }

                e = sa[i];

                if (!(s && e.indexOf(px) === 0 && e === px + btoa(s.slice(l)))) {
                  _context2.next = 21;
                  break;
                }

                __rtb_utils.__rtb_delSS(e);

                rs = true;
                return _context2.abrupt("break", 24);

              case 21:
                i++;
                _context2.next = 15;
                break;

              case 24:
                return _context2.abrupt("return", rs);

              case 25:
              case "end":
                return _context2.stop();
            }
          }
        }, _callee2);
      }))();
    },

    __rtb_clear() {
      var _arguments3 = arguments;
      return _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee3() {
        var rer, px, l, sa, sl, rs, b, m, i, e;
        return regeneratorRuntime.wrap(function _callee3$(_context3) {
          while (1) {
            switch (_context3.prev = _context3.next) {
              case 0:
                rer = _arguments3.length > 0 && _arguments3[0] !== undefined ? _arguments3[0] : 'historyBack';
                px = _arguments3.length > 1 && _arguments3[1] !== undefined ? _arguments3[1] : 'sl,';
                l = _arguments3.length > 2 && _arguments3[2] !== undefined ? _arguments3[2] : -21;
                _context3.next = 5;
                return __rtb_utils.__rtb_ssKeys();

              case 5:
                sa = _context3.sent;
                sl = sa.length;
                rs = true;

                if (sl) {
                  _context3.next = 10;
                  break;
                }

                return _context3.abrupt("return", rs);

              case 10:
                _context3.next = 12;
                return __rtb_utils.__rtb_getSS(rer);

              case 12:
                b = _context3.sent;

                if (b) {
                  m = px + btoa(b.slice(l));
                }

                for (i = 0; i < sl; i++) {
                  e = sa[i];

                  if (e.indexOf(px) === 0 && m !== e) {
                    __rtb_utils.__rtb_delSS(e);
                  }
                }

                return _context3.abrupt("return", true);

              case 16:
              case "end":
                return _context3.stop();
            }
          }
        }, _callee3);
      }))();
    }

  }
};

function normalizeComponent(template, style, script, scopeId, isFunctionalTemplate, moduleIdentifier
/* server only */
, shadowMode, createInjector, createInjectorSSR, createInjectorShadow) {
  if (typeof shadowMode !== 'boolean') {
    createInjectorSSR = createInjector;
    createInjector = shadowMode;
    shadowMode = false;
  } // Vue.extend constructor export interop.


  const options = typeof script === 'function' ? script.options : script; // render functions

  if (template && template.render) {
    options.render = template.render;
    options.staticRenderFns = template.staticRenderFns;
    options._compiled = true; // functional template

    if (isFunctionalTemplate) {
      options.functional = true;
    }
  } // scopedId


  if (scopeId) {
    options._scopeId = scopeId;
  }

  let hook;

  if (moduleIdentifier) {
    // server build
    hook = function (context) {
      // 2.3 injection
      context = context || // cached call
      this.$vnode && this.$vnode.ssrContext || // stateful
      this.parent && this.parent.$vnode && this.parent.$vnode.ssrContext; // functional
      // 2.2 with runInNewContext: true

      if (!context && typeof __VUE_SSR_CONTEXT__ !== 'undefined') {
        context = __VUE_SSR_CONTEXT__;
      } // inject component styles


      if (style) {
        style.call(this, createInjectorSSR(context));
      } // register component module identifier for async chunk inference


      if (context && context._registeredComponents) {
        context._registeredComponents.add(moduleIdentifier);
      }
    }; // used by ssr in case component is cached and beforeCreate
    // never gets called


    options._ssrRegister = hook;
  } else if (style) {
    hook = shadowMode ? function (context) {
      style.call(this, createInjectorShadow(context, this.$root.$options.shadowRoot));
    } : function (context) {
      style.call(this, createInjector(context));
    };
  }

  if (hook) {
    if (options.functional) {
      // register for functional component in vue file
      const originalRender = options.render;

      options.render = function renderWithStyleInjection(h, context) {
        hook.call(context);
        return originalRender(h, context);
      };
    } else {
      // inject component registration as beforeCreate hook
      const existing = options.beforeCreate;
      options.beforeCreate = existing ? [].concat(existing, hook) : [hook];
    }
  }

  return script;
}

/* script */
const __vue_script__ = script;

/* template */

  /* style */
  const __vue_inject_styles__ = undefined;
  /* scoped */
  const __vue_scope_id__ = undefined;
  /* module identifier */
  const __vue_module_identifier__ = undefined;
  /* functional template */
  const __vue_is_functional_template__ = undefined;
  /* style inject */
  
  /* style inject SSR */
  
  /* style inject shadow dom */
  

  
  const __vue_component__ = normalizeComponent(
    {},
    __vue_inject_styles__,
    __vue_script__,
    __vue_scope_id__,
    __vue_is_functional_template__,
    __vue_module_identifier__,
    false,
    undefined,
    undefined,
    undefined
  );

var components = [__vue_component__];

var install = function install(Vue) {
  components.forEach(function (component) {
    Vue.mixin(component);
  });
};

if (typeof window !== 'undefined' && window.Vue) {
  install(window.Vue);
}
 // if need to install as component

export default install;
export { __vue_component__ as Routable };
