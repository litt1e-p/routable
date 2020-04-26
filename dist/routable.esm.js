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

function toArray(arr) {
  return Array.prototype.slice.call(arr);
}

function promisifyRequest(request) {
  return new Promise(function (resolve, reject) {
    request.onsuccess = function () {
      resolve(request.result);
    };

    request.onerror = function () {
      reject(request.error);
    };
  });
}

function promisifyRequestCall(obj, method, args) {
  var request;
  var p = new Promise(function (resolve, reject) {
    request = obj[method].apply(obj, args);
    promisifyRequest(request).then(resolve, reject);
  });
  p.request = request;
  return p;
}

function promisifyCursorRequestCall(obj, method, args) {
  var p = promisifyRequestCall(obj, method, args);
  return p.then(function (value) {
    if (!value) return;
    return new Cursor(value, p.request);
  });
}

function proxyProperties(ProxyClass, targetProp, properties) {
  properties.forEach(function (prop) {
    Object.defineProperty(ProxyClass.prototype, prop, {
      get: function () {
        return this[targetProp][prop];
      },
      set: function (val) {
        this[targetProp][prop] = val;
      }
    });
  });
}

function proxyRequestMethods(ProxyClass, targetProp, Constructor, properties) {
  properties.forEach(function (prop) {
    if (!(prop in Constructor.prototype)) return;

    ProxyClass.prototype[prop] = function () {
      return promisifyRequestCall(this[targetProp], prop, arguments);
    };
  });
}

function proxyMethods(ProxyClass, targetProp, Constructor, properties) {
  properties.forEach(function (prop) {
    if (!(prop in Constructor.prototype)) return;

    ProxyClass.prototype[prop] = function () {
      return this[targetProp][prop].apply(this[targetProp], arguments);
    };
  });
}

function proxyCursorRequestMethods(ProxyClass, targetProp, Constructor, properties) {
  properties.forEach(function (prop) {
    if (!(prop in Constructor.prototype)) return;

    ProxyClass.prototype[prop] = function () {
      return promisifyCursorRequestCall(this[targetProp], prop, arguments);
    };
  });
}

function Index(index) {
  this._index = index;
}

proxyProperties(Index, '_index', ['name', 'keyPath', 'multiEntry', 'unique']);
proxyRequestMethods(Index, '_index', IDBIndex, ['get', 'getKey', 'getAll', 'getAllKeys', 'count']);
proxyCursorRequestMethods(Index, '_index', IDBIndex, ['openCursor', 'openKeyCursor']);

function Cursor(cursor, request) {
  this._cursor = cursor;
  this._request = request;
}

proxyProperties(Cursor, '_cursor', ['direction', 'key', 'primaryKey', 'value']);
proxyRequestMethods(Cursor, '_cursor', IDBCursor, ['update', 'delete']); // proxy 'next' methods

['advance', 'continue', 'continuePrimaryKey'].forEach(function (methodName) {
  if (!(methodName in IDBCursor.prototype)) return;

  Cursor.prototype[methodName] = function () {
    var cursor = this;
    var args = arguments;
    return Promise.resolve().then(function () {
      cursor._cursor[methodName].apply(cursor._cursor, args);

      return promisifyRequest(cursor._request).then(function (value) {
        if (!value) return;
        return new Cursor(value, cursor._request);
      });
    });
  };
});

function ObjectStore(store) {
  this._store = store;
}

ObjectStore.prototype.createIndex = function () {
  return new Index(this._store.createIndex.apply(this._store, arguments));
};

ObjectStore.prototype.index = function () {
  return new Index(this._store.index.apply(this._store, arguments));
};

proxyProperties(ObjectStore, '_store', ['name', 'keyPath', 'indexNames', 'autoIncrement']);
proxyRequestMethods(ObjectStore, '_store', IDBObjectStore, ['put', 'add', 'delete', 'clear', 'get', 'getAll', 'getKey', 'getAllKeys', 'count']);
proxyCursorRequestMethods(ObjectStore, '_store', IDBObjectStore, ['openCursor', 'openKeyCursor']);
proxyMethods(ObjectStore, '_store', IDBObjectStore, ['deleteIndex']);

function Transaction(idbTransaction) {
  this._tx = idbTransaction;
  this.complete = new Promise(function (resolve, reject) {
    idbTransaction.oncomplete = function () {
      resolve();
    };

    idbTransaction.onerror = function () {
      reject(idbTransaction.error);
    };

    idbTransaction.onabort = function () {
      reject(idbTransaction.error);
    };
  });
}

Transaction.prototype.objectStore = function () {
  return new ObjectStore(this._tx.objectStore.apply(this._tx, arguments));
};

proxyProperties(Transaction, '_tx', ['objectStoreNames', 'mode']);
proxyMethods(Transaction, '_tx', IDBTransaction, ['abort']);

function UpgradeDB(db, oldVersion, transaction) {
  this._db = db;
  this.oldVersion = oldVersion;
  this.transaction = new Transaction(transaction);
}

UpgradeDB.prototype.createObjectStore = function () {
  return new ObjectStore(this._db.createObjectStore.apply(this._db, arguments));
};

proxyProperties(UpgradeDB, '_db', ['name', 'version', 'objectStoreNames']);
proxyMethods(UpgradeDB, '_db', IDBDatabase, ['deleteObjectStore', 'close']);

function DB(db) {
  this._db = db;
}

DB.prototype.transaction = function () {
  return new Transaction(this._db.transaction.apply(this._db, arguments));
};

proxyProperties(DB, '_db', ['name', 'version', 'objectStoreNames']);
proxyMethods(DB, '_db', IDBDatabase, ['close']); // Add cursor iterators
// TODO: remove this once browsers do the right thing with promises

['openCursor', 'openKeyCursor'].forEach(function (funcName) {
  [ObjectStore, Index].forEach(function (Constructor) {
    // Don't create iterateKeyCursor if openKeyCursor doesn't exist.
    if (!(funcName in Constructor.prototype)) return;

    Constructor.prototype[funcName.replace('open', 'iterate')] = function () {
      var args = toArray(arguments);
      var callback = args[args.length - 1];
      var nativeObject = this._store || this._index;
      var request = nativeObject[funcName].apply(nativeObject, args.slice(0, -1));

      request.onsuccess = function () {
        callback(request.result);
      };
    };
  });
}); // polyfill getAll

[Index, ObjectStore].forEach(function (Constructor) {
  if (Constructor.prototype.getAll) return;

  Constructor.prototype.getAll = function (query, count) {
    var instance = this;
    var items = [];
    return new Promise(function (resolve) {
      instance.iterateCursor(query, function (cursor) {
        if (!cursor) {
          resolve(items);
          return;
        }

        items.push(cursor.value);

        if (count !== undefined && items.length == count) {
          resolve(items);
          return;
        }

        cursor.continue();
      });
    });
  };
});
function openDb(name, version, upgradeCallback) {
  var p = promisifyRequestCall(indexedDB, 'open', [name, version]);
  var request = p.request;

  if (request) {
    request.onupgradeneeded = function (event) {
      if (upgradeCallback) {
        upgradeCallback(new UpgradeDB(request.result, event.oldVersion, request.transaction));
      }
    };
  }

  return p.then(function (db) {
    return new DB(db);
  });
}

if (!('indexedDB' in window)) {
  throw new Error('fatal error: the browser does not support indexedDb');
}

var _dbName = '__rtb_db_routable';
var _tbName = '__rtb_db_table';

var _db = openDb(_dbName, 1, function (db) {
  db.createObjectStore(_tbName);
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
      var db, tx;
      return regeneratorRuntime.wrap(function _callee$(_context) {
        while (1) {
          switch (_context.prev = _context.next) {
            case 0:
              _context.next = 2;
              return _db;

            case 2:
              db = _context.sent;
              tx = db.transaction(_tbName, 'readwrite');
              tx.objectStore(_tbName).put(v, k);
              return _context.abrupt("return", tx.complete);

            case 6:
            case "end":
              return _context.stop();
          }
        }
      }, _callee);
    }))();
  },

  __rtb_getSS(k) {
    return _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee2() {
      var db;
      return regeneratorRuntime.wrap(function _callee2$(_context2) {
        while (1) {
          switch (_context2.prev = _context2.next) {
            case 0:
              _context2.next = 2;
              return _db;

            case 2:
              db = _context2.sent;
              return _context2.abrupt("return", db.transaction(_tbName).objectStore(_tbName).get(k));

            case 4:
            case "end":
              return _context2.stop();
          }
        }
      }, _callee2);
    }))();
  },

  __rtb_delSS(k) {
    return _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee3() {
      var db, tx;
      return regeneratorRuntime.wrap(function _callee3$(_context3) {
        while (1) {
          switch (_context3.prev = _context3.next) {
            case 0:
              _context3.next = 2;
              return _db;

            case 2:
              db = _context3.sent;
              tx = db.transaction(_tbName, 'readwrite');
              tx.objectStore(_tbName).delete(k);
              return _context3.abrupt("return", tx.complete);

            case 6:
            case "end":
              return _context3.stop();
          }
        }
      }, _callee3);
    }))();
  },

  __rtb_clearSS() {
    return _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee4() {
      var db, tx;
      return regeneratorRuntime.wrap(function _callee4$(_context4) {
        while (1) {
          switch (_context4.prev = _context4.next) {
            case 0:
              _context4.next = 2;
              return _db;

            case 2:
              db = _context4.sent;
              tx = db.transaction(_tbName, 'readwrite');
              tx.objectStore(_tbName).clear();
              return _context4.abrupt("return", tx.complete);

            case 6:
            case "end":
              return _context4.stop();
          }
        }
      }, _callee4);
    }))();
  },

  __rtb_ssKeys() {
    return _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee5() {
      var db;
      return regeneratorRuntime.wrap(function _callee5$(_context5) {
        while (1) {
          switch (_context5.prev = _context5.next) {
            case 0:
              _context5.next = 2;
              return _db;

            case 2:
              db = _context5.sent;
              return _context5.abrupt("return", db.transaction(_tbName).objectStore(_tbName).getAllKeys());

            case 4:
            case "end":
              return _context5.stop();
          }
        }
      }, _callee5);
    }))();
  }

};

var script = {
  name: 'litt1epRoutable',
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
        var exception, px, l, sa, sl, rs, b, m, i, e;
        return regeneratorRuntime.wrap(function _callee3$(_context3) {
          while (1) {
            switch (_context3.prev = _context3.next) {
              case 0:
                exception = _arguments3.length > 0 && _arguments3[0] !== undefined ? _arguments3[0] : '';
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
                if (!exception) {
                  _context3.next = 16;
                  break;
                }

                _context3.next = 13;
                return __rtb_utils.__rtb_getSS(exception);

              case 13:
                _context3.t0 = _context3.sent;
                _context3.next = 17;
                break;

              case 16:
                _context3.t0 = '';

              case 17:
                b = _context3.t0;

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

              case 21:
              case "end":
                return _context3.stop();
            }
          }
        }, _callee3);
      }))();
    } // },
    // beforeRouteLeave (to, from, next) {
    //   console.info('mxins leave')
    //   next()


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
