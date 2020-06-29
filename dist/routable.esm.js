import util from 'util';

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
      get: function get() {
        return this[targetProp][prop];
      },
      set: function set(val) {
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
}); // polyfill getAllKeys

[Index, ObjectStore].forEach(function (Constructor) {
  if (Constructor.prototype.getAllKeys) return;

  Constructor.prototype.getAllKeys = function (query, count) {
    var instance = this;
    var items = [];
    return new Promise(function (resolve) {
      instance.iterateCursor(query, function (cursor) {
        if (!cursor) {
          resolve(items);
          return;
        }

        items.push(cursor.key);

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

//   throw new Error('Fatal error: the browser does not support indexedDb');
// }

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


var __rtb_dbs = {
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
  },

  __rtb_ssVals() {
    return _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee6() {
      var db;
      return regeneratorRuntime.wrap(function _callee6$(_context6) {
        while (1) {
          switch (_context6.prev = _context6.next) {
            case 0:
              _context6.next = 2;
              return _db;

            case 2:
              db = _context6.sent;
              return _context6.abrupt("return", db.transaction(_tbName).objectStore(_tbName).getAll());

            case 4:
            case "end":
              return _context6.stop();
          }
        }
      }, _callee6);
    }))();
  }

};

var __rtb_clips = {
  _gen: function _gen() {
    var bit = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 32;
    return this._ren(new Date().getTime().toString(bit));
  },
  _ren: function _ren(s) {
    if (!s || !s.length) {
      return s;
    }

    var o = s.split(''),
        r = [];

    while (o.length) {
      var t = o.shift();
      r.unshift(Math.random() > 0.6 ? t.toUpperCase() : t);
    }

    return r.join('');
  },
  _enc: function _enc(px, d) {
    var j = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : '.';
    return px + d.split('').reverse().join(j);
  },
  _dec: function _dec(px, qy) {
    var j = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : '.';
    return px + this._enb(qy.slice(px.length).split(j).reverse().join(''));
  },
  _enp: function _enp(args) {
    return btoa(encodeURIComponent(JSON.stringify(args)));
  },
  _dep: function _dep(args) {
    return JSON.parse(decodeURIComponent(atob(args)));
  },
  _enb: function _enb(s) {
    return btoa(s);
  },
  _deb: function _deb(s) {
    return atob(s);
  }
};

var toStr = Object.prototype.toString;

var isArguments = function isArguments(value) {
  var str = toStr.call(value);
  var isArgs = str === '[object Arguments]';

  if (!isArgs) {
    isArgs = str !== '[object Array]' && value !== null && typeof value === 'object' && typeof value.length === 'number' && value.length >= 0 && toStr.call(value.callee) === '[object Function]';
  }

  return isArgs;
};

var keysShim;

if (!Object.keys) {
  // modified from https://github.com/es-shims/es5-shim
  var has = Object.prototype.hasOwnProperty;
  var toStr$1 = Object.prototype.toString;
  var isArgs = isArguments; // eslint-disable-line global-require

  var isEnumerable = Object.prototype.propertyIsEnumerable;
  var hasDontEnumBug = !isEnumerable.call({
    toString: null
  }, 'toString');
  var hasProtoEnumBug = isEnumerable.call(function () {}, 'prototype');
  var dontEnums = ['toString', 'toLocaleString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'constructor'];

  var equalsConstructorPrototype = function (o) {
    var ctor = o.constructor;
    return ctor && ctor.prototype === o;
  };

  var excludedKeys = {
    $applicationCache: true,
    $console: true,
    $external: true,
    $frame: true,
    $frameElement: true,
    $frames: true,
    $innerHeight: true,
    $innerWidth: true,
    $onmozfullscreenchange: true,
    $onmozfullscreenerror: true,
    $outerHeight: true,
    $outerWidth: true,
    $pageXOffset: true,
    $pageYOffset: true,
    $parent: true,
    $scrollLeft: true,
    $scrollTop: true,
    $scrollX: true,
    $scrollY: true,
    $self: true,
    $webkitIndexedDB: true,
    $webkitStorageInfo: true,
    $window: true
  };

  var hasAutomationEqualityBug = function () {
    /* global window */
    if (typeof window === 'undefined') {
      return false;
    }

    for (var k in window) {
      try {
        if (!excludedKeys['$' + k] && has.call(window, k) && window[k] !== null && typeof window[k] === 'object') {
          try {
            equalsConstructorPrototype(window[k]);
          } catch (e) {
            return true;
          }
        }
      } catch (e) {
        return true;
      }
    }

    return false;
  }();

  var equalsConstructorPrototypeIfNotBuggy = function (o) {
    /* global window */
    if (typeof window === 'undefined' || !hasAutomationEqualityBug) {
      return equalsConstructorPrototype(o);
    }

    try {
      return equalsConstructorPrototype(o);
    } catch (e) {
      return false;
    }
  };

  keysShim = function keys(object) {
    var isObject = object !== null && typeof object === 'object';
    var isFunction = toStr$1.call(object) === '[object Function]';
    var isArguments = isArgs(object);
    var isString = isObject && toStr$1.call(object) === '[object String]';
    var theKeys = [];

    if (!isObject && !isFunction && !isArguments) {
      throw new TypeError('Object.keys called on a non-object');
    }

    var skipProto = hasProtoEnumBug && isFunction;

    if (isString && object.length > 0 && !has.call(object, 0)) {
      for (var i = 0; i < object.length; ++i) {
        theKeys.push(String(i));
      }
    }

    if (isArguments && object.length > 0) {
      for (var j = 0; j < object.length; ++j) {
        theKeys.push(String(j));
      }
    } else {
      for (var name in object) {
        if (!(skipProto && name === 'prototype') && has.call(object, name)) {
          theKeys.push(String(name));
        }
      }
    }

    if (hasDontEnumBug) {
      var skipConstructor = equalsConstructorPrototypeIfNotBuggy(object);

      for (var k = 0; k < dontEnums.length; ++k) {
        if (!(skipConstructor && dontEnums[k] === 'constructor') && has.call(object, dontEnums[k])) {
          theKeys.push(dontEnums[k]);
        }
      }
    }

    return theKeys;
  };
}

var implementation = keysShim;

var slice = Array.prototype.slice;
var origKeys = Object.keys;
var keysShim$1 = origKeys ? function keys(o) {
  return origKeys(o);
} : implementation;
var originalKeys = Object.keys;

keysShim$1.shim = function shimObjectKeys() {
  if (Object.keys) {
    var keysWorksWithArguments = function () {
      // Safari 5.0 bug
      var args = Object.keys(arguments);
      return args && args.length === arguments.length;
    }(1, 2);

    if (!keysWorksWithArguments) {
      Object.keys = function keys(object) {
        // eslint-disable-line func-name-matching
        if (isArguments(object)) {
          return originalKeys(slice.call(object));
        }

        return originalKeys(object);
      };
    }
  } else {
    Object.keys = keysShim$1;
  }

  return Object.keys || keysShim$1;
};

var objectKeys = keysShim$1;

var hasSymbols = typeof Symbol === 'function' && typeof Symbol('foo') === 'symbol';
var toStr$2 = Object.prototype.toString;
var concat = Array.prototype.concat;
var origDefineProperty = Object.defineProperty;

var isFunction = function (fn) {
  return typeof fn === 'function' && toStr$2.call(fn) === '[object Function]';
};

var arePropertyDescriptorsSupported = function () {
  var obj = {};

  try {
    origDefineProperty(obj, 'x', {
      enumerable: false,
      value: obj
    }); // eslint-disable-next-line no-unused-vars, no-restricted-syntax

    for (var _ in obj) {
      // jscs:ignore disallowUnusedVariables
      return false;
    }

    return obj.x === obj;
  } catch (e) {
    /* this is IE 8. */
    return false;
  }
};

var supportsDescriptors = origDefineProperty && arePropertyDescriptorsSupported();

var defineProperty = function (object, name, value, predicate) {
  if (name in object && (!isFunction(predicate) || !predicate())) {
    return;
  }

  if (supportsDescriptors) {
    origDefineProperty(object, name, {
      configurable: true,
      enumerable: false,
      value: value,
      writable: true
    });
  } else {
    object[name] = value;
  }
};

var defineProperties = function (object, map) {
  var predicates = arguments.length > 2 ? arguments[2] : {};
  var props = objectKeys(map);

  if (hasSymbols) {
    props = concat.call(props, Object.getOwnPropertySymbols(map));
  }

  for (var i = 0; i < props.length; i += 1) {
    defineProperty(object, props[i], map[props[i]], predicates[props[i]]);
  }
};

defineProperties.supportsDescriptors = !!supportsDescriptors;
var defineProperties_1 = defineProperties;

/* eslint no-invalid-this: 1 */

var ERROR_MESSAGE = 'Function.prototype.bind called on incompatible ';
var slice$1 = Array.prototype.slice;
var toStr$3 = Object.prototype.toString;
var funcType = '[object Function]';

var implementation$1 = function bind(that) {
  var target = this;

  if (typeof target !== 'function' || toStr$3.call(target) !== funcType) {
    throw new TypeError(ERROR_MESSAGE + target);
  }

  var args = slice$1.call(arguments, 1);
  var bound;

  var binder = function () {
    if (this instanceof bound) {
      var result = target.apply(this, args.concat(slice$1.call(arguments)));

      if (Object(result) === result) {
        return result;
      }

      return this;
    } else {
      return target.apply(that, args.concat(slice$1.call(arguments)));
    }
  };

  var boundLength = Math.max(0, target.length - args.length);
  var boundArgs = [];

  for (var i = 0; i < boundLength; i++) {
    boundArgs.push('$' + i);
  }

  bound = Function('binder', 'return function (' + boundArgs.join(',') + '){ return binder.apply(this,arguments); }')(binder);

  if (target.prototype) {
    var Empty = function Empty() {};

    Empty.prototype = target.prototype;
    bound.prototype = new Empty();
    Empty.prototype = null;
  }

  return bound;
};

var functionBind = Function.prototype.bind || implementation$1;

var util_inspect = util.inspect;

var hasMap = typeof Map === 'function' && Map.prototype;
var mapSizeDescriptor = Object.getOwnPropertyDescriptor && hasMap ? Object.getOwnPropertyDescriptor(Map.prototype, 'size') : null;
var mapSize = hasMap && mapSizeDescriptor && typeof mapSizeDescriptor.get === 'function' ? mapSizeDescriptor.get : null;
var mapForEach = hasMap && Map.prototype.forEach;
var hasSet = typeof Set === 'function' && Set.prototype;
var setSizeDescriptor = Object.getOwnPropertyDescriptor && hasSet ? Object.getOwnPropertyDescriptor(Set.prototype, 'size') : null;
var setSize = hasSet && setSizeDescriptor && typeof setSizeDescriptor.get === 'function' ? setSizeDescriptor.get : null;
var setForEach = hasSet && Set.prototype.forEach;
var hasWeakMap = typeof WeakMap === 'function' && WeakMap.prototype;
var weakMapHas = hasWeakMap ? WeakMap.prototype.has : null;
var hasWeakSet = typeof WeakSet === 'function' && WeakSet.prototype;
var weakSetHas = hasWeakSet ? WeakSet.prototype.has : null;
var booleanValueOf = Boolean.prototype.valueOf;
var objectToString = Object.prototype.toString;
var functionToString = Function.prototype.toString;
var match = String.prototype.match;
var bigIntValueOf = typeof BigInt === 'function' ? BigInt.prototype.valueOf : null;
var inspectCustom = util_inspect.custom;
var inspectSymbol = inspectCustom && isSymbol(inspectCustom) ? inspectCustom : null;

var objectInspect = function inspect_(obj, options, depth, seen) {
  var opts = options || {};

  if (has$1(opts, 'quoteStyle') && opts.quoteStyle !== 'single' && opts.quoteStyle !== 'double') {
    throw new TypeError('option "quoteStyle" must be "single" or "double"');
  }

  if (has$1(opts, 'maxStringLength') && (typeof opts.maxStringLength === 'number' ? opts.maxStringLength < 0 && opts.maxStringLength !== Infinity : opts.maxStringLength !== null)) {
    throw new TypeError('option "maxStringLength", if provided, must be a positive integer, Infinity, or `null`');
  }

  var customInspect = has$1(opts, 'customInspect') ? opts.customInspect : true;

  if (typeof customInspect !== 'boolean') {
    throw new TypeError('option "customInspect", if provided, must be `true` or `false`');
  }

  if (has$1(opts, 'indent') && opts.indent !== null && opts.indent !== '\t' && !(parseInt(opts.indent, 10) === opts.indent && opts.indent > 0)) {
    throw new TypeError('options "indent" must be "\\t", an integer > 0, or `null`');
  }

  if (typeof obj === 'undefined') {
    return 'undefined';
  }

  if (obj === null) {
    return 'null';
  }

  if (typeof obj === 'boolean') {
    return obj ? 'true' : 'false';
  }

  if (typeof obj === 'string') {
    return inspectString(obj, opts);
  }

  if (typeof obj === 'number') {
    if (obj === 0) {
      return Infinity / obj > 0 ? '0' : '-0';
    }

    return String(obj);
  }

  if (typeof obj === 'bigint') {
    // eslint-disable-line valid-typeof
    return String(obj) + 'n';
  }

  var maxDepth = typeof opts.depth === 'undefined' ? 5 : opts.depth;

  if (typeof depth === 'undefined') {
    depth = 0;
  }

  if (depth >= maxDepth && maxDepth > 0 && typeof obj === 'object') {
    return isArray(obj) ? '[Array]' : '[Object]';
  }

  var indent = getIndent(opts, depth);

  if (typeof seen === 'undefined') {
    seen = [];
  } else if (indexOf(seen, obj) >= 0) {
    return '[Circular]';
  }

  function inspect(value, from, noIndent) {
    if (from) {
      seen = seen.slice();
      seen.push(from);
    }

    if (noIndent) {
      var newOpts = {
        depth: opts.depth
      };

      if (has$1(opts, 'quoteStyle')) {
        newOpts.quoteStyle = opts.quoteStyle;
      }

      return inspect_(value, newOpts, depth + 1, seen);
    }

    return inspect_(value, opts, depth + 1, seen);
  }

  if (typeof obj === 'function') {
    var name = nameOf(obj);
    return '[Function' + (name ? ': ' + name : ' (anonymous)') + ']';
  }

  if (isSymbol(obj)) {
    var symString = Symbol.prototype.toString.call(obj);
    return typeof obj === 'object' ? markBoxed(symString) : symString;
  }

  if (isElement(obj)) {
    var s = '<' + String(obj.nodeName).toLowerCase();
    var attrs = obj.attributes || [];

    for (var i = 0; i < attrs.length; i++) {
      s += ' ' + attrs[i].name + '=' + wrapQuotes(quote(attrs[i].value), 'double', opts);
    }

    s += '>';

    if (obj.childNodes && obj.childNodes.length) {
      s += '...';
    }

    s += '</' + String(obj.nodeName).toLowerCase() + '>';
    return s;
  }

  if (isArray(obj)) {
    if (obj.length === 0) {
      return '[]';
    }

    var xs = arrObjKeys(obj, inspect);

    if (indent && !singleLineValues(xs)) {
      return '[' + indentedJoin(xs, indent) + ']';
    }

    return '[ ' + xs.join(', ') + ' ]';
  }

  if (isError(obj)) {
    var parts = arrObjKeys(obj, inspect);

    if (parts.length === 0) {
      return '[' + String(obj) + ']';
    }

    return '{ [' + String(obj) + '] ' + parts.join(', ') + ' }';
  }

  if (typeof obj === 'object' && customInspect) {
    if (inspectSymbol && typeof obj[inspectSymbol] === 'function') {
      return obj[inspectSymbol]();
    } else if (typeof obj.inspect === 'function') {
      return obj.inspect();
    }
  }

  if (isMap(obj)) {
    var mapParts = [];
    mapForEach.call(obj, function (value, key) {
      mapParts.push(inspect(key, obj, true) + ' => ' + inspect(value, obj));
    });
    return collectionOf('Map', mapSize.call(obj), mapParts, indent);
  }

  if (isSet(obj)) {
    var setParts = [];
    setForEach.call(obj, function (value) {
      setParts.push(inspect(value, obj));
    });
    return collectionOf('Set', setSize.call(obj), setParts, indent);
  }

  if (isWeakMap(obj)) {
    return weakCollectionOf('WeakMap');
  }

  if (isWeakSet(obj)) {
    return weakCollectionOf('WeakSet');
  }

  if (isNumber(obj)) {
    return markBoxed(inspect(Number(obj)));
  }

  if (isBigInt(obj)) {
    return markBoxed(inspect(bigIntValueOf.call(obj)));
  }

  if (isBoolean(obj)) {
    return markBoxed(booleanValueOf.call(obj));
  }

  if (isString(obj)) {
    return markBoxed(inspect(String(obj)));
  }

  if (!isDate(obj) && !isRegExp(obj)) {
    var ys = arrObjKeys(obj, inspect);

    if (ys.length === 0) {
      return '{}';
    }

    if (indent) {
      return '{' + indentedJoin(ys, indent) + '}';
    }

    return '{ ' + ys.join(', ') + ' }';
  }

  return String(obj);
};

function wrapQuotes(s, defaultStyle, opts) {
  var quoteChar = (opts.quoteStyle || defaultStyle) === 'double' ? '"' : "'";
  return quoteChar + s + quoteChar;
}

function quote(s) {
  return String(s).replace(/"/g, '&quot;');
}

function isArray(obj) {
  return toStr$4(obj) === '[object Array]';
}

function isDate(obj) {
  return toStr$4(obj) === '[object Date]';
}

function isRegExp(obj) {
  return toStr$4(obj) === '[object RegExp]';
}

function isError(obj) {
  return toStr$4(obj) === '[object Error]';
}

function isSymbol(obj) {
  return toStr$4(obj) === '[object Symbol]';
}

function isString(obj) {
  return toStr$4(obj) === '[object String]';
}

function isNumber(obj) {
  return toStr$4(obj) === '[object Number]';
}

function isBigInt(obj) {
  return toStr$4(obj) === '[object BigInt]';
}

function isBoolean(obj) {
  return toStr$4(obj) === '[object Boolean]';
}

var hasOwn = Object.prototype.hasOwnProperty || function (key) {
  return key in this;
};

function has$1(obj, key) {
  return hasOwn.call(obj, key);
}

function toStr$4(obj) {
  return objectToString.call(obj);
}

function nameOf(f) {
  if (f.name) {
    return f.name;
  }

  var m = match.call(functionToString.call(f), /^function\s*([\w$]+)/);

  if (m) {
    return m[1];
  }

  return null;
}

function indexOf(xs, x) {
  if (xs.indexOf) {
    return xs.indexOf(x);
  }

  for (var i = 0, l = xs.length; i < l; i++) {
    if (xs[i] === x) {
      return i;
    }
  }

  return -1;
}

function isMap(x) {
  if (!mapSize || !x || typeof x !== 'object') {
    return false;
  }

  try {
    mapSize.call(x);

    try {
      setSize.call(x);
    } catch (s) {
      return true;
    }

    return x instanceof Map; // core-js workaround, pre-v2.5.0
  } catch (e) {}

  return false;
}

function isWeakMap(x) {
  if (!weakMapHas || !x || typeof x !== 'object') {
    return false;
  }

  try {
    weakMapHas.call(x, weakMapHas);

    try {
      weakSetHas.call(x, weakSetHas);
    } catch (s) {
      return true;
    }

    return x instanceof WeakMap; // core-js workaround, pre-v2.5.0
  } catch (e) {}

  return false;
}

function isSet(x) {
  if (!setSize || !x || typeof x !== 'object') {
    return false;
  }

  try {
    setSize.call(x);

    try {
      mapSize.call(x);
    } catch (m) {
      return true;
    }

    return x instanceof Set; // core-js workaround, pre-v2.5.0
  } catch (e) {}

  return false;
}

function isWeakSet(x) {
  if (!weakSetHas || !x || typeof x !== 'object') {
    return false;
  }

  try {
    weakSetHas.call(x, weakSetHas);

    try {
      weakMapHas.call(x, weakMapHas);
    } catch (s) {
      return true;
    }

    return x instanceof WeakSet; // core-js workaround, pre-v2.5.0
  } catch (e) {}

  return false;
}

function isElement(x) {
  if (!x || typeof x !== 'object') {
    return false;
  }

  if (typeof HTMLElement !== 'undefined' && x instanceof HTMLElement) {
    return true;
  }

  return typeof x.nodeName === 'string' && typeof x.getAttribute === 'function';
}

function inspectString(str, opts) {
  if (str.length > opts.maxStringLength) {
    var remaining = str.length - opts.maxStringLength;
    var trailer = '... ' + remaining + ' more character' + (remaining > 1 ? 's' : '');
    return inspectString(str.slice(0, opts.maxStringLength), opts) + trailer;
  } // eslint-disable-next-line no-control-regex


  var s = str.replace(/(['\\])/g, '\\$1').replace(/[\x00-\x1f]/g, lowbyte);
  return wrapQuotes(s, 'single', opts);
}

function lowbyte(c) {
  var n = c.charCodeAt(0);
  var x = {
    8: 'b',
    9: 't',
    10: 'n',
    12: 'f',
    13: 'r'
  }[n];

  if (x) {
    return '\\' + x;
  }

  return '\\x' + (n < 0x10 ? '0' : '') + n.toString(16);
}

function markBoxed(str) {
  return 'Object(' + str + ')';
}

function weakCollectionOf(type) {
  return type + ' { ? }';
}

function collectionOf(type, size, entries, indent) {
  var joinedEntries = indent ? indentedJoin(entries, indent) : entries.join(', ');
  return type + ' (' + size + ') {' + joinedEntries + '}';
}

function singleLineValues(xs) {
  for (var i = 0; i < xs.length; i++) {
    if (indexOf(xs[i], '\n') >= 0) {
      return false;
    }
  }

  return true;
}

function getIndent(opts, depth) {
  var baseIndent;

  if (opts.indent === '\t') {
    baseIndent = '\t';
  } else if (typeof opts.indent === 'number' && opts.indent > 0) {
    baseIndent = Array(opts.indent + 1).join(' ');
  } else {
    return null;
  }

  return {
    base: baseIndent,
    prev: Array(depth + 1).join(baseIndent)
  };
}

function indentedJoin(xs, indent) {
  if (xs.length === 0) {
    return '';
  }

  var lineJoiner = '\n' + indent.prev + indent.base;
  return lineJoiner + xs.join(',' + lineJoiner) + '\n' + indent.prev;
}

function arrObjKeys(obj, inspect) {
  var isArr = isArray(obj);
  var xs = [];

  if (isArr) {
    xs.length = obj.length;

    for (var i = 0; i < obj.length; i++) {
      xs[i] = has$1(obj, i) ? inspect(obj[i], obj) : '';
    }
  }

  for (var key in obj) {
    // eslint-disable-line no-restricted-syntax
    if (!has$1(obj, key)) {
      continue;
    } // eslint-disable-line no-restricted-syntax, no-continue


    if (isArr && String(Number(key)) === key && key < obj.length) {
      continue;
    } // eslint-disable-line no-restricted-syntax, no-continue


    if (/[^\w$]/.test(key)) {
      xs.push(inspect(key, obj) + ': ' + inspect(obj[key], obj));
    } else {
      xs.push(key + ': ' + inspect(obj[key], obj));
    }
  }

  return xs;
}

var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

function createCommonjsModule(fn, module) {
	return module = { exports: {} }, fn(module, module.exports), module.exports;
}

/* eslint complexity: [2, 18], max-statements: [2, 33] */

var shams = function hasSymbols() {
  if (typeof Symbol !== 'function' || typeof Object.getOwnPropertySymbols !== 'function') {
    return false;
  }

  if (typeof Symbol.iterator === 'symbol') {
    return true;
  }

  var obj = {};
  var sym = Symbol('test');
  var symObj = Object(sym);

  if (typeof sym === 'string') {
    return false;
  }

  if (Object.prototype.toString.call(sym) !== '[object Symbol]') {
    return false;
  }

  if (Object.prototype.toString.call(symObj) !== '[object Symbol]') {
    return false;
  } // temp disabled per https://github.com/ljharb/object.assign/issues/17
  // if (sym instanceof Symbol) { return false; }
  // temp disabled per https://github.com/WebReflection/get-own-property-symbols/issues/4
  // if (!(symObj instanceof Symbol)) { return false; }
  // if (typeof Symbol.prototype.toString !== 'function') { return false; }
  // if (String(sym) !== Symbol.prototype.toString.call(sym)) { return false; }


  var symVal = 42;
  obj[sym] = symVal;

  for (sym in obj) {
    return false;
  } // eslint-disable-line no-restricted-syntax


  if (typeof Object.keys === 'function' && Object.keys(obj).length !== 0) {
    return false;
  }

  if (typeof Object.getOwnPropertyNames === 'function' && Object.getOwnPropertyNames(obj).length !== 0) {
    return false;
  }

  var syms = Object.getOwnPropertySymbols(obj);

  if (syms.length !== 1 || syms[0] !== sym) {
    return false;
  }

  if (!Object.prototype.propertyIsEnumerable.call(obj, sym)) {
    return false;
  }

  if (typeof Object.getOwnPropertyDescriptor === 'function') {
    var descriptor = Object.getOwnPropertyDescriptor(obj, sym);

    if (descriptor.value !== symVal || descriptor.enumerable !== true) {
      return false;
    }
  }

  return true;
};

var origSymbol = commonjsGlobal.Symbol;

var hasSymbols$1 = function hasNativeSymbols() {
  if (typeof origSymbol !== 'function') {
    return false;
  }

  if (typeof Symbol !== 'function') {
    return false;
  }

  if (typeof origSymbol('foo') !== 'symbol') {
    return false;
  }

  if (typeof Symbol('bar') !== 'symbol') {
    return false;
  }

  return shams();
};

/* globals
	Atomics,
	SharedArrayBuffer,
*/


var undefined$1;
var $TypeError = TypeError;
var $gOPD = Object.getOwnPropertyDescriptor;

if ($gOPD) {
  try {
    $gOPD({}, '');
  } catch (e) {
    $gOPD = null; // this is IE 8, which has a broken gOPD
  }
}

var throwTypeError = function () {
  throw new $TypeError();
};

var ThrowTypeError = $gOPD ? function () {
  try {
    // eslint-disable-next-line no-unused-expressions, no-caller, no-restricted-properties
    arguments.callee; // IE 8 does not throw here

    return throwTypeError;
  } catch (calleeThrows) {
    try {
      // IE 8 throws on Object.getOwnPropertyDescriptor(arguments, '')
      return $gOPD(arguments, 'callee').get;
    } catch (gOPDthrows) {
      return throwTypeError;
    }
  }
}() : throwTypeError;
var hasSymbols$2 = hasSymbols$1();

var getProto = Object.getPrototypeOf || function (x) {
  return x.__proto__;
}; // eslint-disable-line no-proto

var generatorFunction =  undefined$1;

var asyncFunction =  undefined$1;

var asyncGenFunction =  undefined$1;
var TypedArray = typeof Uint8Array === 'undefined' ? undefined$1 : getProto(Uint8Array);
var INTRINSICS = {
  '%Array%': Array,
  '%ArrayBuffer%': typeof ArrayBuffer === 'undefined' ? undefined$1 : ArrayBuffer,
  '%ArrayBufferPrototype%': typeof ArrayBuffer === 'undefined' ? undefined$1 : ArrayBuffer.prototype,
  '%ArrayIteratorPrototype%': hasSymbols$2 ? getProto([][Symbol.iterator]()) : undefined$1,
  '%ArrayPrototype%': Array.prototype,
  '%ArrayProto_entries%': Array.prototype.entries,
  '%ArrayProto_forEach%': Array.prototype.forEach,
  '%ArrayProto_keys%': Array.prototype.keys,
  '%ArrayProto_values%': Array.prototype.values,
  '%AsyncFromSyncIteratorPrototype%': undefined$1,
  '%AsyncFunction%': asyncFunction,
  '%AsyncFunctionPrototype%':  undefined$1,
  '%AsyncGenerator%':  undefined$1,
  '%AsyncGeneratorFunction%': asyncGenFunction,
  '%AsyncGeneratorPrototype%':  undefined$1,
  '%AsyncIteratorPrototype%':  undefined$1,
  '%Atomics%': typeof Atomics === 'undefined' ? undefined$1 : Atomics,
  '%Boolean%': Boolean,
  '%BooleanPrototype%': Boolean.prototype,
  '%DataView%': typeof DataView === 'undefined' ? undefined$1 : DataView,
  '%DataViewPrototype%': typeof DataView === 'undefined' ? undefined$1 : DataView.prototype,
  '%Date%': Date,
  '%DatePrototype%': Date.prototype,
  '%decodeURI%': decodeURI,
  '%decodeURIComponent%': decodeURIComponent,
  '%encodeURI%': encodeURI,
  '%encodeURIComponent%': encodeURIComponent,
  '%Error%': Error,
  '%ErrorPrototype%': Error.prototype,
  '%eval%': eval,
  // eslint-disable-line no-eval
  '%EvalError%': EvalError,
  '%EvalErrorPrototype%': EvalError.prototype,
  '%Float32Array%': typeof Float32Array === 'undefined' ? undefined$1 : Float32Array,
  '%Float32ArrayPrototype%': typeof Float32Array === 'undefined' ? undefined$1 : Float32Array.prototype,
  '%Float64Array%': typeof Float64Array === 'undefined' ? undefined$1 : Float64Array,
  '%Float64ArrayPrototype%': typeof Float64Array === 'undefined' ? undefined$1 : Float64Array.prototype,
  '%Function%': Function,
  '%FunctionPrototype%': Function.prototype,
  '%Generator%':  undefined$1,
  '%GeneratorFunction%': generatorFunction,
  '%GeneratorPrototype%':  undefined$1,
  '%Int8Array%': typeof Int8Array === 'undefined' ? undefined$1 : Int8Array,
  '%Int8ArrayPrototype%': typeof Int8Array === 'undefined' ? undefined$1 : Int8Array.prototype,
  '%Int16Array%': typeof Int16Array === 'undefined' ? undefined$1 : Int16Array,
  '%Int16ArrayPrototype%': typeof Int16Array === 'undefined' ? undefined$1 : Int8Array.prototype,
  '%Int32Array%': typeof Int32Array === 'undefined' ? undefined$1 : Int32Array,
  '%Int32ArrayPrototype%': typeof Int32Array === 'undefined' ? undefined$1 : Int32Array.prototype,
  '%isFinite%': isFinite,
  '%isNaN%': isNaN,
  '%IteratorPrototype%': hasSymbols$2 ? getProto(getProto([][Symbol.iterator]())) : undefined$1,
  '%JSON%': typeof JSON === 'object' ? JSON : undefined$1,
  '%JSONParse%': typeof JSON === 'object' ? JSON.parse : undefined$1,
  '%Map%': typeof Map === 'undefined' ? undefined$1 : Map,
  '%MapIteratorPrototype%': typeof Map === 'undefined' || !hasSymbols$2 ? undefined$1 : getProto(new Map()[Symbol.iterator]()),
  '%MapPrototype%': typeof Map === 'undefined' ? undefined$1 : Map.prototype,
  '%Math%': Math,
  '%Number%': Number,
  '%NumberPrototype%': Number.prototype,
  '%Object%': Object,
  '%ObjectPrototype%': Object.prototype,
  '%ObjProto_toString%': Object.prototype.toString,
  '%ObjProto_valueOf%': Object.prototype.valueOf,
  '%parseFloat%': parseFloat,
  '%parseInt%': parseInt,
  '%Promise%': typeof Promise === 'undefined' ? undefined$1 : Promise,
  '%PromisePrototype%': typeof Promise === 'undefined' ? undefined$1 : Promise.prototype,
  '%PromiseProto_then%': typeof Promise === 'undefined' ? undefined$1 : Promise.prototype.then,
  '%Promise_all%': typeof Promise === 'undefined' ? undefined$1 : Promise.all,
  '%Promise_reject%': typeof Promise === 'undefined' ? undefined$1 : Promise.reject,
  '%Promise_resolve%': typeof Promise === 'undefined' ? undefined$1 : Promise.resolve,
  '%Proxy%': typeof Proxy === 'undefined' ? undefined$1 : Proxy,
  '%RangeError%': RangeError,
  '%RangeErrorPrototype%': RangeError.prototype,
  '%ReferenceError%': ReferenceError,
  '%ReferenceErrorPrototype%': ReferenceError.prototype,
  '%Reflect%': typeof Reflect === 'undefined' ? undefined$1 : Reflect,
  '%RegExp%': RegExp,
  '%RegExpPrototype%': RegExp.prototype,
  '%Set%': typeof Set === 'undefined' ? undefined$1 : Set,
  '%SetIteratorPrototype%': typeof Set === 'undefined' || !hasSymbols$2 ? undefined$1 : getProto(new Set()[Symbol.iterator]()),
  '%SetPrototype%': typeof Set === 'undefined' ? undefined$1 : Set.prototype,
  '%SharedArrayBuffer%': typeof SharedArrayBuffer === 'undefined' ? undefined$1 : SharedArrayBuffer,
  '%SharedArrayBufferPrototype%': typeof SharedArrayBuffer === 'undefined' ? undefined$1 : SharedArrayBuffer.prototype,
  '%String%': String,
  '%StringIteratorPrototype%': hasSymbols$2 ? getProto(''[Symbol.iterator]()) : undefined$1,
  '%StringPrototype%': String.prototype,
  '%Symbol%': hasSymbols$2 ? Symbol : undefined$1,
  '%SymbolPrototype%': hasSymbols$2 ? Symbol.prototype : undefined$1,
  '%SyntaxError%': SyntaxError,
  '%SyntaxErrorPrototype%': SyntaxError.prototype,
  '%ThrowTypeError%': ThrowTypeError,
  '%TypedArray%': TypedArray,
  '%TypedArrayPrototype%': TypedArray ? TypedArray.prototype : undefined$1,
  '%TypeError%': $TypeError,
  '%TypeErrorPrototype%': $TypeError.prototype,
  '%Uint8Array%': typeof Uint8Array === 'undefined' ? undefined$1 : Uint8Array,
  '%Uint8ArrayPrototype%': typeof Uint8Array === 'undefined' ? undefined$1 : Uint8Array.prototype,
  '%Uint8ClampedArray%': typeof Uint8ClampedArray === 'undefined' ? undefined$1 : Uint8ClampedArray,
  '%Uint8ClampedArrayPrototype%': typeof Uint8ClampedArray === 'undefined' ? undefined$1 : Uint8ClampedArray.prototype,
  '%Uint16Array%': typeof Uint16Array === 'undefined' ? undefined$1 : Uint16Array,
  '%Uint16ArrayPrototype%': typeof Uint16Array === 'undefined' ? undefined$1 : Uint16Array.prototype,
  '%Uint32Array%': typeof Uint32Array === 'undefined' ? undefined$1 : Uint32Array,
  '%Uint32ArrayPrototype%': typeof Uint32Array === 'undefined' ? undefined$1 : Uint32Array.prototype,
  '%URIError%': URIError,
  '%URIErrorPrototype%': URIError.prototype,
  '%WeakMap%': typeof WeakMap === 'undefined' ? undefined$1 : WeakMap,
  '%WeakMapPrototype%': typeof WeakMap === 'undefined' ? undefined$1 : WeakMap.prototype,
  '%WeakSet%': typeof WeakSet === 'undefined' ? undefined$1 : WeakSet,
  '%WeakSetPrototype%': typeof WeakSet === 'undefined' ? undefined$1 : WeakSet.prototype
};
var $replace = functionBind.call(Function.call, String.prototype.replace);
/* adapted from https://github.com/lodash/lodash/blob/4.17.15/dist/lodash.js#L6735-L6744 */

var rePropName = /[^%.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|%$))/g;
var reEscapeChar = /\\(\\)?/g;
/** Used to match backslashes in property paths. */

var stringToPath = function stringToPath(string) {
  var result = [];
  $replace(string, rePropName, function (match, number, quote, subString) {
    result[result.length] = quote ? $replace(subString, reEscapeChar, '$1') : number || match;
  });
  return result;
};
/* end adaptation */


var getBaseIntrinsic = function getBaseIntrinsic(name, allowMissing) {
  if (!(name in INTRINSICS)) {
    throw new SyntaxError('intrinsic ' + name + ' does not exist!');
  } // istanbul ignore if // hopefully this is impossible to test :-)


  if (typeof INTRINSICS[name] === 'undefined' && !allowMissing) {
    throw new $TypeError('intrinsic ' + name + ' exists, but is not available. Please file an issue!');
  }

  return INTRINSICS[name];
};

var GetIntrinsic = function GetIntrinsic(name, allowMissing) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('intrinsic name must be a non-empty string');
  }

  if (arguments.length > 1 && typeof allowMissing !== 'boolean') {
    throw new TypeError('"allowMissing" argument must be a boolean');
  }

  var parts = stringToPath(name);
  var value = getBaseIntrinsic('%' + (parts.length > 0 ? parts[0] : '') + '%', allowMissing);

  for (var i = 1; i < parts.length; i += 1) {
    if (value != null) {
      if ($gOPD && i + 1 >= parts.length) {
        var desc = $gOPD(value, parts[i]);

        if (!allowMissing && !(parts[i] in value)) {
          throw new $TypeError('base intrinsic for ' + name + ' exists, but the property is not available.');
        }

        value = desc ? desc.get || desc.value : value[parts[i]];
      } else {
        value = value[parts[i]];
      }
    }
  }

  return value;
};

var $apply = GetIntrinsic('%Function.prototype.apply%');
var $call = GetIntrinsic('%Function.prototype.call%');
var $reflectApply = GetIntrinsic('%Reflect.apply%', true) || functionBind.call($call, $apply);

var callBind = function callBind() {
  return $reflectApply(functionBind, $call, arguments);
};

var apply = function applyBind() {
  return $reflectApply(functionBind, $apply, arguments);
};
callBind.apply = apply;

var $indexOf = callBind(GetIntrinsic('String.prototype.indexOf'));

var callBound = function callBoundIntrinsic(name, allowMissing) {
  var intrinsic = GetIntrinsic(name, !!allowMissing);

  if (typeof intrinsic === 'function' && $indexOf(name, '.prototype.')) {
    return callBind(intrinsic);
  }

  return intrinsic;
};

var $apply$1 = GetIntrinsic('%Reflect.apply%', true) || callBound('%Function.prototype.apply%'); // https://www.ecma-international.org/ecma-262/6.0/#sec-call

var Call = function Call(F, V) {
  var args = arguments.length > 2 ? arguments[2] : [];
  return $apply$1(F, V, args);
};

var IsPropertyKey = function IsPropertyKey(argument) {
  return typeof argument === 'string' || typeof argument === 'symbol';
};

var Type = function Type(x) {
  if (x === null) {
    return 'Null';
  }

  if (typeof x === 'undefined') {
    return 'Undefined';
  }

  if (typeof x === 'function' || typeof x === 'object') {
    return 'Object';
  }

  if (typeof x === 'number') {
    return 'Number';
  }

  if (typeof x === 'boolean') {
    return 'Boolean';
  }

  if (typeof x === 'string') {
    return 'String';
  }
};

var Type$1 = function Type$1(x) {
  if (typeof x === 'symbol') {
    return 'Symbol';
  }

  return Type(x);
};

var $TypeError$1 = GetIntrinsic('%TypeError%');
/**
 * 7.3.1 Get (O, P) - https://ecma-international.org/ecma-262/6.0/#sec-get-o-p
 * 1. Assert: Type(O) is Object.
 * 2. Assert: IsPropertyKey(P) is true.
 * 3. Return O.[[Get]](P, O).
 */

var Get = function Get(O, P) {
  // 7.3.1.1
  if (Type$1(O) !== 'Object') {
    throw new $TypeError$1('Assertion failed: Type(O) is not Object');
  } // 7.3.1.2


  if (!IsPropertyKey(P)) {
    throw new $TypeError$1('Assertion failed: IsPropertyKey(P) is not true, got ' + objectInspect(P));
  } // 7.3.1.3


  return O[P];
};

var hasSymbols$3 = hasSymbols$1();
var $iterator = GetIntrinsic('%Symbol.iterator%', true);
var $stringSlice = callBound('String.prototype.slice');

var getIteratorMethod = function getIteratorMethod(ES, iterable) {
  var usingIterator;

  if (hasSymbols$3) {
    usingIterator = ES.GetMethod(iterable, $iterator);
  } else if (ES.IsArray(iterable)) {
    usingIterator = function () {
      var i = -1;
      var arr = this; // eslint-disable-line no-invalid-this

      return {
        next: function () {
          i += 1;
          return {
            done: i >= arr.length,
            value: arr[i]
          };
        }
      };
    };
  } else if (ES.Type(iterable) === 'String') {
    usingIterator = function () {
      var i = 0;
      return {
        next: function () {
          var nextIndex = ES.AdvanceStringIndex(iterable, i, true);
          var value = $stringSlice(iterable, i, nextIndex);
          i = nextIndex;
          return {
            done: nextIndex > iterable.length,
            value: value
          };
        }
      };
    };
  }

  return usingIterator;
};

var _isNaN = Number.isNaN || function isNaN(a) {
  return a !== a;
};

var $isNaN = Number.isNaN || function (a) {
  return a !== a;
};

var _isFinite = Number.isFinite || function (x) {
  return typeof x === 'number' && !$isNaN(x) && x !== Infinity && x !== -Infinity;
};

var $Math = GetIntrinsic('%Math%');
var $floor = $Math.floor;
var $abs = $Math.abs; // https://www.ecma-international.org/ecma-262/6.0/#sec-isinteger

var IsInteger = function IsInteger(argument) {
  if (typeof argument !== 'number' || _isNaN(argument) || !_isFinite(argument)) {
    return false;
  }

  var abs = $abs(argument);
  return $floor(abs) === abs;
};

var $Math$1 = GetIntrinsic('%Math%');
var $Number = GetIntrinsic('%Number%');
var maxSafeInteger = $Number.MAX_SAFE_INTEGER || $Math$1.pow(2, 53) - 1;

var $TypeError$2 = GetIntrinsic('%TypeError%');
var $charCodeAt = callBound('String.prototype.charCodeAt'); // https://ecma-international.org/ecma-262/6.0/#sec-advancestringindex

var AdvanceStringIndex = function AdvanceStringIndex(S, index, unicode) {
  if (Type$1(S) !== 'String') {
    throw new $TypeError$2('Assertion failed: `S` must be a String');
  }

  if (!IsInteger(index) || index < 0 || index > maxSafeInteger) {
    throw new $TypeError$2('Assertion failed: `length` must be an integer >= 0 and <= 2**53');
  }

  if (Type$1(unicode) !== 'Boolean') {
    throw new $TypeError$2('Assertion failed: `unicode` must be a Boolean');
  }

  if (!unicode) {
    return index + 1;
  }

  var length = S.length;

  if (index + 1 >= length) {
    return index + 1;
  }

  var first = $charCodeAt(S, index);

  if (first < 0xD800 || first > 0xDBFF) {
    return index + 1;
  }

  var second = $charCodeAt(S, index + 1);

  if (second < 0xDC00 || second > 0xDFFF) {
    return index + 1;
  }

  return index + 2;
};

var $TypeError$3 = GetIntrinsic('%TypeError%'); // http://www.ecma-international.org/ecma-262/5.1/#sec-9.10

var CheckObjectCoercible = function CheckObjectCoercible(value, optMessage) {
  if (value == null) {
    throw new $TypeError$3(optMessage || 'Cannot call method on ' + value);
  }

  return value;
};

var RequireObjectCoercible = CheckObjectCoercible;

var $Object = GetIntrinsic('%Object%'); // https://www.ecma-international.org/ecma-262/6.0/#sec-toobject

var ToObject = function ToObject(value) {
  RequireObjectCoercible(value);
  return $Object(value);
};

var $TypeError$4 = GetIntrinsic('%TypeError%');
/**
 * 7.3.2 GetV (V, P)
 * 1. Assert: IsPropertyKey(P) is true.
 * 2. Let O be ToObject(V).
 * 3. ReturnIfAbrupt(O).
 * 4. Return O.[[Get]](P, V).
 */

var GetV = function GetV(V, P) {
  // 7.3.2.1
  if (!IsPropertyKey(P)) {
    throw new $TypeError$4('Assertion failed: IsPropertyKey(P) is not true');
  } // 7.3.2.2-3


  var O = ToObject(V); // 7.3.2.4

  return O[P];
};

var fnToStr = Function.prototype.toString;
var reflectApply = typeof Reflect === 'object' && Reflect !== null && Reflect.apply;
var badArrayLike;
var isCallableMarker;

if (typeof reflectApply === 'function' && typeof Object.defineProperty === 'function') {
  try {
    badArrayLike = Object.defineProperty({}, 'length', {
      get: function () {
        throw isCallableMarker;
      }
    });
    isCallableMarker = {};
  } catch (_) {
    reflectApply = null;
  }
} else {
  reflectApply = null;
}

var constructorRegex = /^\s*class\b/;

var isES6ClassFn = function isES6ClassFunction(value) {
  try {
    var fnStr = fnToStr.call(value);
    return constructorRegex.test(fnStr);
  } catch (e) {
    return false; // not a function
  }
};

var tryFunctionObject = function tryFunctionToStr(value) {
  try {
    if (isES6ClassFn(value)) {
      return false;
    }

    fnToStr.call(value);
    return true;
  } catch (e) {
    return false;
  }
};

var toStr$5 = Object.prototype.toString;
var fnClass = '[object Function]';
var genClass = '[object GeneratorFunction]';
var hasToStringTag = typeof Symbol === 'function' && typeof Symbol.toStringTag === 'symbol';
var isCallable = reflectApply ? function isCallable(value) {
  if (!value) {
    return false;
  }

  if (typeof value !== 'function' && typeof value !== 'object') {
    return false;
  }

  if (typeof value === 'function' && !value.prototype) {
    return true;
  }

  try {
    reflectApply(value, null, badArrayLike);
  } catch (e) {
    if (e !== isCallableMarker) {
      return false;
    }
  }

  return !isES6ClassFn(value);
} : function isCallable(value) {
  if (!value) {
    return false;
  }

  if (typeof value !== 'function' && typeof value !== 'object') {
    return false;
  }

  if (typeof value === 'function' && !value.prototype) {
    return true;
  }

  if (hasToStringTag) {
    return tryFunctionObject(value);
  }

  if (isES6ClassFn(value)) {
    return false;
  }

  var strClass = toStr$5.call(value);
  return strClass === fnClass || strClass === genClass;
};

var IsCallable = isCallable;

var $TypeError$5 = GetIntrinsic('%TypeError%');
/**
 * 7.3.9 - https://ecma-international.org/ecma-262/6.0/#sec-getmethod
 * 1. Assert: IsPropertyKey(P) is true.
 * 2. Let func be GetV(O, P).
 * 3. ReturnIfAbrupt(func).
 * 4. If func is either undefined or null, return undefined.
 * 5. If IsCallable(func) is false, throw a TypeError exception.
 * 6. Return func.
 */

var GetMethod = function GetMethod(O, P) {
  // 7.3.9.1
  if (!IsPropertyKey(P)) {
    throw new $TypeError$5('Assertion failed: IsPropertyKey(P) is not true');
  } // 7.3.9.2


  var func = GetV(O, P); // 7.3.9.4

  if (func == null) {
    return void 0;
  } // 7.3.9.5


  if (!IsCallable(func)) {
    throw new $TypeError$5(P + 'is not a function');
  } // 7.3.9.6


  return func;
};

var $Array = GetIntrinsic('%Array%'); // eslint-disable-next-line global-require

var toStr$6 = !$Array.isArray && callBound('Object.prototype.toString'); // https://www.ecma-international.org/ecma-262/6.0/#sec-isarray

var IsArray = $Array.isArray || function IsArray(argument) {
  return toStr$6(argument) === '[object Array]';
};

var $TypeError$6 = GetIntrinsic('%TypeError%'); // https://ecma-international.org/ecma-262/6.0/#sec-getiterator

var GetIterator = function GetIterator(obj, method) {
  var actualMethod = method;

  if (arguments.length < 2) {
    actualMethod = getIteratorMethod({
      AdvanceStringIndex: AdvanceStringIndex,
      GetMethod: GetMethod,
      IsArray: IsArray,
      Type: Type$1
    }, obj);
  }

  var iterator = Call(actualMethod, obj);

  if (Type$1(iterator) !== 'Object') {
    throw new $TypeError$6('iterator must return an object');
  }

  return iterator;
};

var $TypeError$7 = GetIntrinsic('%TypeError%'); // https://ecma-international.org/ecma-262/6.0/#sec-iteratorclose

var IteratorClose = function IteratorClose(iterator, completion) {
  if (Type$1(iterator) !== 'Object') {
    throw new $TypeError$7('Assertion failed: Type(iterator) is not Object');
  }

  if (!IsCallable(completion)) {
    throw new $TypeError$7('Assertion failed: completion is not a thunk for a Completion Record');
  }

  var completionThunk = completion;
  var iteratorReturn = GetMethod(iterator, 'return');

  if (typeof iteratorReturn === 'undefined') {
    return completionThunk();
  }

  var completionRecord;

  try {
    var innerResult = Call(iteratorReturn, iterator, []);
  } catch (e) {
    // if we hit here, then "e" is the innerResult completion that needs re-throwing
    // if the completion is of type "throw", this will throw.
    completionThunk();
    completionThunk = null; // ensure it's not called twice.
    // if not, then return the innerResult completion

    throw e;
  }

  completionRecord = completionThunk(); // if innerResult worked, then throw if the completion does

  completionThunk = null; // ensure it's not called twice.

  if (Type$1(innerResult) !== 'Object') {
    throw new $TypeError$7('iterator .return must return an object');
  }

  return completionRecord;
};

var ToBoolean = function ToBoolean(value) {
  return !!value;
};

var $TypeError$8 = GetIntrinsic('%TypeError%'); // https://ecma-international.org/ecma-262/6.0/#sec-iteratorcomplete

var IteratorComplete = function IteratorComplete(iterResult) {
  if (Type$1(iterResult) !== 'Object') {
    throw new $TypeError$8('Assertion failed: Type(iterResult) is not Object');
  }

  return ToBoolean(Get(iterResult, 'done'));
};

var $TypeError$9 = GetIntrinsic('%TypeError%');
var $arraySlice = callBound('Array.prototype.slice'); // https://ecma-international.org/ecma-262/6.0/#sec-invoke

var Invoke = function Invoke(O, P) {
  if (!IsPropertyKey(P)) {
    throw new $TypeError$9('P must be a Property Key');
  }

  var argumentsList = $arraySlice(arguments, 2);
  var func = GetV(O, P);
  return Call(func, O, argumentsList);
};

var $TypeError$a = GetIntrinsic('%TypeError%'); // https://ecma-international.org/ecma-262/6.0/#sec-iteratornext

var IteratorNext = function IteratorNext(iterator, value) {
  var result = Invoke(iterator, 'next', arguments.length < 2 ? [] : [value]);

  if (Type$1(result) !== 'Object') {
    throw new $TypeError$a('iterator next must return an object');
  }

  return result;
};

var IteratorStep = function IteratorStep(iterator) {
  var result = IteratorNext(iterator);
  var done = IteratorComplete(result);
  return done === true ? false : result;
};

var $TypeError$b = GetIntrinsic('%TypeError%'); // https://ecma-international.org/ecma-262/6.0/#sec-iteratorvalue

var IteratorValue = function IteratorValue(iterResult) {
  if (Type$1(iterResult) !== 'Object') {
    throw new $TypeError$b('Assertion failed: Type(iterResult) is not Object');
  }

  return Get(iterResult, 'value');
};

var $TypeError$c = GetIntrinsic('%TypeError%'); // https://tc39.es/ecma262/#sec-add-entries-from-iterable

var AddEntriesFromIterable = function AddEntriesFromIterable(target, iterable, adder) {
  if (!IsCallable(adder)) {
    throw new $TypeError$c('Assertion failed: `adder` is not callable');
  }

  if (iterable == null) {
    throw new $TypeError$c('Assertion failed: `iterable` is present, and not nullish');
  }

  var iteratorRecord = GetIterator(iterable);

  while (true) {
    // eslint-disable-line no-constant-condition
    var next = IteratorStep(iteratorRecord);

    if (!next) {
      return target;
    }

    var nextItem = IteratorValue(next);

    if (Type$1(nextItem) !== 'Object') {
      var error = new $TypeError$c('iterator next must return an Object, got ' + objectInspect(nextItem));
      return IteratorClose(iteratorRecord, function () {
        throw error;
      } // eslint-disable-line no-loop-func
      );
    }

    try {
      var k = Get(nextItem, '0');
      var v = Get(nextItem, '1');
      Call(adder, target, [k, v]);
    } catch (e) {
      return IteratorClose(iteratorRecord, function () {
        throw e;
      });
    }
  }
};

var $defineProperty = GetIntrinsic('%Object.defineProperty%', true);

if ($defineProperty) {
  try {
    $defineProperty({}, 'a', {
      value: 1
    });
  } catch (e) {
    // IE 8 has a broken defineProperty
    $defineProperty = null;
  }
}

var $isEnumerable = callBound('Object.prototype.propertyIsEnumerable'); // eslint-disable-next-line max-params

var DefineOwnProperty = function DefineOwnProperty(IsDataDescriptor, SameValue, FromPropertyDescriptor, O, P, desc) {
  if (!$defineProperty) {
    if (!IsDataDescriptor(desc)) {
      // ES3 does not support getters/setters
      return false;
    }

    if (!desc['[[Configurable]]'] || !desc['[[Writable]]']) {
      return false;
    } // fallback for ES3


    if (P in O && $isEnumerable(O, P) !== !!desc['[[Enumerable]]']) {
      // a non-enumerable existing property
      return false;
    } // property does not exist at all, or exists but is enumerable


    var V = desc['[[Value]]']; // eslint-disable-next-line no-param-reassign

    O[P] = V; // will use [[Define]]

    return SameValue(O[P], V);
  }

  $defineProperty(O, P, FromPropertyDescriptor(desc));
  return true;
};

var src = functionBind.call(Function.call, Object.prototype.hasOwnProperty);

var $TypeError$d = GetIntrinsic('%TypeError%');
var $SyntaxError = GetIntrinsic('%SyntaxError%');
var predicates = {
  // https://ecma-international.org/ecma-262/6.0/#sec-property-descriptor-specification-type
  'Property Descriptor': function isPropertyDescriptor(Type, Desc) {
    if (Type(Desc) !== 'Object') {
      return false;
    }

    var allowed = {
      '[[Configurable]]': true,
      '[[Enumerable]]': true,
      '[[Get]]': true,
      '[[Set]]': true,
      '[[Value]]': true,
      '[[Writable]]': true
    };

    for (var key in Desc) {
      // eslint-disable-line
      if (src(Desc, key) && !allowed[key]) {
        return false;
      }
    }

    var isData = src(Desc, '[[Value]]');
    var IsAccessor = src(Desc, '[[Get]]') || src(Desc, '[[Set]]');

    if (isData && IsAccessor) {
      throw new $TypeError$d('Property Descriptors may not be both accessor and data descriptors');
    }

    return true;
  }
};

var assertRecord = function assertRecord(Type, recordType, argumentName, value) {
  var predicate = predicates[recordType];

  if (typeof predicate !== 'function') {
    throw new $SyntaxError('unknown record type: ' + recordType);
  }

  if (!predicate(Type, value)) {
    throw new $TypeError$d(argumentName + ' must be a ' + recordType);
  }
};

var FromPropertyDescriptor = function FromPropertyDescriptor(Desc) {
  if (typeof Desc === 'undefined') {
    return Desc;
  }

  assertRecord(Type$1, 'Property Descriptor', 'Desc', Desc);
  var obj = {};

  if ('[[Value]]' in Desc) {
    obj.value = Desc['[[Value]]'];
  }

  if ('[[Writable]]' in Desc) {
    obj.writable = Desc['[[Writable]]'];
  }

  if ('[[Get]]' in Desc) {
    obj.get = Desc['[[Get]]'];
  }

  if ('[[Set]]' in Desc) {
    obj.set = Desc['[[Set]]'];
  }

  if ('[[Enumerable]]' in Desc) {
    obj.enumerable = Desc['[[Enumerable]]'];
  }

  if ('[[Configurable]]' in Desc) {
    obj.configurable = Desc['[[Configurable]]'];
  }

  return obj;
};

var $gOPD$1 = GetIntrinsic('%Object.getOwnPropertyDescriptor%');

if ($gOPD$1) {
  try {
    $gOPD$1([], 'length');
  } catch (e) {
    // IE 8 has a broken gOPD
    $gOPD$1 = null;
  }
}

var getOwnPropertyDescriptor = $gOPD$1;

var hasSymbols$4 = hasSymbols$1();
var hasToStringTag$1 = hasSymbols$4 && typeof Symbol.toStringTag === 'symbol';
var regexExec;
var isRegexMarker;
var badStringifier;

if (hasToStringTag$1) {
  regexExec = Function.call.bind(RegExp.prototype.exec);
  isRegexMarker = {};

  var throwRegexMarker = function () {
    throw isRegexMarker;
  };

  badStringifier = {
    toString: throwRegexMarker,
    valueOf: throwRegexMarker
  };

  if (typeof Symbol.toPrimitive === 'symbol') {
    badStringifier[Symbol.toPrimitive] = throwRegexMarker;
  }
}

var toStr$7 = Object.prototype.toString;
var regexClass = '[object RegExp]';
var isRegex = hasToStringTag$1 // eslint-disable-next-line consistent-return
? function isRegex(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  try {
    regexExec(value, badStringifier);
  } catch (e) {
    return e === isRegexMarker;
  }
} : function isRegex(value) {
  // In older browsers, typeof regex incorrectly returns 'function'
  if (!value || typeof value !== 'object' && typeof value !== 'function') {
    return false;
  }

  return toStr$7.call(value) === regexClass;
};

var $match = GetIntrinsic('%Symbol.match%', true); // https://ecma-international.org/ecma-262/6.0/#sec-isregexp

var IsRegExp = function IsRegExp(argument) {
  if (!argument || typeof argument !== 'object') {
    return false;
  }

  if ($match) {
    var isRegExp = argument[$match];

    if (typeof isRegExp !== 'undefined') {
      return ToBoolean(isRegExp);
    }
  }

  return isRegex(argument);
};

var $TypeError$e = GetIntrinsic('%TypeError%'); // https://ecma-international.org/ecma-262/5.1/#sec-8.10.5

var ToPropertyDescriptor = function ToPropertyDescriptor(Obj) {
  if (Type$1(Obj) !== 'Object') {
    throw new $TypeError$e('ToPropertyDescriptor requires an object');
  }

  var desc = {};

  if (src(Obj, 'enumerable')) {
    desc['[[Enumerable]]'] = ToBoolean(Obj.enumerable);
  }

  if (src(Obj, 'configurable')) {
    desc['[[Configurable]]'] = ToBoolean(Obj.configurable);
  }

  if (src(Obj, 'value')) {
    desc['[[Value]]'] = Obj.value;
  }

  if (src(Obj, 'writable')) {
    desc['[[Writable]]'] = ToBoolean(Obj.writable);
  }

  if (src(Obj, 'get')) {
    var getter = Obj.get;

    if (typeof getter !== 'undefined' && !IsCallable(getter)) {
      throw new TypeError('getter must be a function');
    }

    desc['[[Get]]'] = getter;
  }

  if (src(Obj, 'set')) {
    var setter = Obj.set;

    if (typeof setter !== 'undefined' && !IsCallable(setter)) {
      throw new $TypeError$e('setter must be a function');
    }

    desc['[[Set]]'] = setter;
  }

  if ((src(desc, '[[Get]]') || src(desc, '[[Set]]')) && (src(desc, '[[Value]]') || src(desc, '[[Writable]]'))) {
    throw new $TypeError$e('Invalid property descriptor. Cannot both specify accessors and a value or writable attribute');
  }

  return desc;
};

var $TypeError$f = GetIntrinsic('%TypeError%');
var $isEnumerable$1 = callBound('Object.prototype.propertyIsEnumerable'); // https://www.ecma-international.org/ecma-262/6.0/#sec-ordinarygetownproperty

var OrdinaryGetOwnProperty = function OrdinaryGetOwnProperty(O, P) {
  if (Type$1(O) !== 'Object') {
    throw new $TypeError$f('Assertion failed: O must be an Object');
  }

  if (!IsPropertyKey(P)) {
    throw new $TypeError$f('Assertion failed: P must be a Property Key');
  }

  if (!src(O, P)) {
    return void 0;
  }

  if (!getOwnPropertyDescriptor) {
    // ES3 / IE 8 fallback
    var arrayLength = IsArray(O) && P === 'length';
    var regexLastIndex = IsRegExp(O) && P === 'lastIndex';
    return {
      '[[Configurable]]': !(arrayLength || regexLastIndex),
      '[[Enumerable]]': $isEnumerable$1(O, P),
      '[[Value]]': O[P],
      '[[Writable]]': true
    };
  }

  return ToPropertyDescriptor(getOwnPropertyDescriptor(O, P));
};

var IsDataDescriptor = function IsDataDescriptor(Desc) {
  if (typeof Desc === 'undefined') {
    return false;
  }

  assertRecord(Type$1, 'Property Descriptor', 'Desc', Desc);

  if (!src(Desc, '[[Value]]') && !src(Desc, '[[Writable]]')) {
    return false;
  }

  return true;
};

var isPrimitive = function isPrimitive(value) {
  return value === null || typeof value !== 'function' && typeof value !== 'object';
};

var $Object$1 = GetIntrinsic('%Object%');
var $preventExtensions = $Object$1.preventExtensions;
var $isExtensible = $Object$1.isExtensible; // https://www.ecma-international.org/ecma-262/6.0/#sec-isextensible-o

var IsExtensible = $preventExtensions ? function IsExtensible(obj) {
  return !isPrimitive(obj) && $isExtensible(obj);
} : function IsExtensible(obj) {
  return !isPrimitive(obj);
};

var SameValue = function SameValue(x, y) {
  if (x === y) {
    // 0 === -0, but they are not identical.
    if (x === 0) {
      return 1 / x === 1 / y;
    }

    return true;
  }

  return _isNaN(x) && _isNaN(y);
};

var $TypeError$g = GetIntrinsic('%TypeError%'); // https://www.ecma-international.org/ecma-262/6.0/#sec-createdataproperty

var CreateDataProperty = function CreateDataProperty(O, P, V) {
  if (Type$1(O) !== 'Object') {
    throw new $TypeError$g('Assertion failed: Type(O) is not Object');
  }

  if (!IsPropertyKey(P)) {
    throw new $TypeError$g('Assertion failed: IsPropertyKey(P) is not true');
  }

  var oldDesc = OrdinaryGetOwnProperty(O, P);
  var extensible = !oldDesc || IsExtensible(O);
  var immutable = oldDesc && (!oldDesc['[[Writable]]'] || !oldDesc['[[Configurable]]']);

  if (immutable || !extensible) {
    return false;
  }

  return DefineOwnProperty(IsDataDescriptor, SameValue, FromPropertyDescriptor, O, P, {
    '[[Configurable]]': true,
    '[[Enumerable]]': true,
    '[[Value]]': V,
    '[[Writable]]': true
  });
};

var $TypeError$h = GetIntrinsic('%TypeError%'); // // https://ecma-international.org/ecma-262/6.0/#sec-createdatapropertyorthrow

var CreateDataPropertyOrThrow = function CreateDataPropertyOrThrow(O, P, V) {
  if (Type$1(O) !== 'Object') {
    throw new $TypeError$h('Assertion failed: Type(O) is not Object');
  }

  if (!IsPropertyKey(P)) {
    throw new $TypeError$h('Assertion failed: IsPropertyKey(P) is not true');
  }

  var success = CreateDataProperty(O, P, V);

  if (!success) {
    throw new $TypeError$h('unable to create data property');
  }

  return success;
};

var isPrimitive$1 = function isPrimitive(value) {
  return value === null || typeof value !== 'function' && typeof value !== 'object';
};

var getDay = Date.prototype.getDay;

var tryDateObject = function tryDateGetDayCall(value) {
  try {
    getDay.call(value);
    return true;
  } catch (e) {
    return false;
  }
};

var toStr$8 = Object.prototype.toString;
var dateClass = '[object Date]';
var hasToStringTag$2 = typeof Symbol === 'function' && typeof Symbol.toStringTag === 'symbol';

var isDateObject = function isDateObject(value) {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return hasToStringTag$2 ? tryDateObject(value) : toStr$8.call(value) === dateClass;
};

var isSymbol$1 = createCommonjsModule(function (module) {

  var toStr = Object.prototype.toString;
  var hasSymbols = hasSymbols$1();

  if (hasSymbols) {
    var symToStr = Symbol.prototype.toString;
    var symStringRegex = /^Symbol\(.*\)$/;

    var isSymbolObject = function isRealSymbolObject(value) {
      if (typeof value.valueOf() !== 'symbol') {
        return false;
      }

      return symStringRegex.test(symToStr.call(value));
    };

    module.exports = function isSymbol(value) {
      if (typeof value === 'symbol') {
        return true;
      }

      if (toStr.call(value) !== '[object Symbol]') {
        return false;
      }

      try {
        return isSymbolObject(value);
      } catch (e) {
        return false;
      }
    };
  } else {
    module.exports = function isSymbol(value) {
      // this environment does not support Symbols.
      return false ;
    };
  }
});

var hasSymbols$5 = typeof Symbol === 'function' && typeof Symbol.iterator === 'symbol';

var ordinaryToPrimitive = function OrdinaryToPrimitive(O, hint) {
  if (typeof O === 'undefined' || O === null) {
    throw new TypeError('Cannot call method on ' + O);
  }

  if (typeof hint !== 'string' || hint !== 'number' && hint !== 'string') {
    throw new TypeError('hint must be "string" or "number"');
  }

  var methodNames = hint === 'string' ? ['toString', 'valueOf'] : ['valueOf', 'toString'];
  var method, result, i;

  for (i = 0; i < methodNames.length; ++i) {
    method = O[methodNames[i]];

    if (isCallable(method)) {
      result = method.call(O);

      if (isPrimitive$1(result)) {
        return result;
      }
    }
  }

  throw new TypeError('No default value');
};

var GetMethod$1 = function GetMethod(O, P) {
  var func = O[P];

  if (func !== null && typeof func !== 'undefined') {
    if (!isCallable(func)) {
      throw new TypeError(func + ' returned for property ' + P + ' of object ' + O + ' is not a function');
    }

    return func;
  }

  return void 0;
}; // http://www.ecma-international.org/ecma-262/6.0/#sec-toprimitive


var es2015 = function ToPrimitive(input) {
  if (isPrimitive$1(input)) {
    return input;
  }

  var hint = 'default';

  if (arguments.length > 1) {
    if (arguments[1] === String) {
      hint = 'string';
    } else if (arguments[1] === Number) {
      hint = 'number';
    }
  }

  var exoticToPrim;

  if (hasSymbols$5) {
    if (Symbol.toPrimitive) {
      exoticToPrim = GetMethod$1(input, Symbol.toPrimitive);
    } else if (isSymbol$1(input)) {
      exoticToPrim = Symbol.prototype.valueOf;
    }
  }

  if (typeof exoticToPrim !== 'undefined') {
    var result = exoticToPrim.call(input, hint);

    if (isPrimitive$1(result)) {
      return result;
    }

    throw new TypeError('unable to convert exotic object to primitive');
  }

  if (hint === 'default' && (isDateObject(input) || isSymbol$1(input))) {
    hint = 'string';
  }

  return ordinaryToPrimitive(input, hint === 'default' ? 'number' : hint);
};

var ToPrimitive = function ToPrimitive(input) {
  if (arguments.length > 1) {
    return es2015(input, arguments[1]);
  }

  return es2015(input);
};

var $String = GetIntrinsic('%String%');
var $TypeError$i = GetIntrinsic('%TypeError%'); // https://www.ecma-international.org/ecma-262/6.0/#sec-tostring

var ToString = function ToString(argument) {
  if (typeof argument === 'symbol') {
    throw new $TypeError$i('Cannot convert a Symbol value to a string');
  }

  return $String(argument);
};

var $String$1 = GetIntrinsic('%String%'); // https://www.ecma-international.org/ecma-262/6.0/#sec-topropertykey

var ToPropertyKey = function ToPropertyKey(argument) {
  var key = ToPrimitive(argument, $String$1);
  return typeof key === 'symbol' ? key : ToString(key);
};

var adder = function addDataProperty(key, value) {
  var O = this; // eslint-disable-line no-invalid-this

  var propertyKey = ToPropertyKey(key);
  CreateDataPropertyOrThrow(O, propertyKey, value);
};

var legacyAssign = function assign(obj, entries) {
  for (var i = 0; i < entries.length; ++i) {
    var entry = entries[i];

    if (Type$1(entry) !== 'Object') {
      throw new TypeError('iterator returned a non-object; entry expected');
    }

    var key = Get(entry, '0');
    var value = Get(entry, '1');
    var propertyKey = ToPropertyKey(key);
    CreateDataPropertyOrThrow(obj, propertyKey, value);
  }
};

var hasSymbols$6 = typeof Symbol === 'function' && typeof Symbol('foo') === 'symbol';

var implementation$2 = function fromEntries(iterable) {
  RequireObjectCoercible(iterable);
  var obj = {}; // this part isn't in the spec, it's for a reasonable fallback for pre-ES6 environments

  if (!hasSymbols$6) {
    if (!IsArray(iterable)) {
      throw new TypeError('this environment lacks native Symbols, and can not support non-Array iterables');
    }

    legacyAssign(obj, iterable);
    return obj;
  }

  return AddEntriesFromIterable(obj, iterable, adder);
};

var polyfill = function getPolyfill() {
  return typeof Object.fromEntries === 'function' ? Object.fromEntries : implementation$2;
};

var shim = function shimEntries() {
  var polyfill$1 = polyfill();
  defineProperties_1(Object, {
    fromEntries: polyfill$1
  }, {
    fromEntries: function testEntries() {
      return Object.fromEntries !== polyfill$1;
    }
  });
  return polyfill$1;
};

var polyfill$1 = functionBind.call(polyfill());
defineProperties_1(polyfill$1, {
  getPolyfill: polyfill,
  implementation: implementation$2,
  shim: shim
});
var object_fromentries = polyfill$1;

if (!Object.fromEntries) {
  object_fromentries.shim();
}

var script = {
  name: 'litt1epRoutable',
  methods: {
    __rtb_set(k, v) {
      return __rtb_dbs.__rtb_setSS.apply(this, [k, v]);
    },

    __rtb_get(k) {
      return __rtb_dbs.__rtb_getSS.call(this, k);
    },

    __rtb_erased(args) {
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

      this.__rtb_set(px + btoa(rc), btoa(encodeURIComponent(JSON.stringify(args))));

      var o = Object.prototype.constructor();
      o[qy] = px + btoa((rd * 0xFFFFFF << 7).toString(16)).split('').reverse().join('.') + ':' + rc;
      return o;
    },

    __rtb_erase(args) {
      var c = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;
      var bit = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 32;
      var px = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : 'sl,';
      var qy = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : 'gs_l';

      if (!args || args.length <= 0) {
        return '';
      }

      if (!c) {
        var _o2 = Object.prototype.constructor();

        _o2[qy] = __rtb_clips._enp(args);
        return _o2;
      }

      var rcb = __rtb_clips._gen(bit);

      this.__rtb_set(px + __rtb_clips._enb(rcb), __rtb_clips._enp(args));

      var o = Object.prototype.constructor();
      o[qy] = __rtb_clips._enc(px, rcb);
      return o;
    },

    __rtb_record(args) {
      var _arguments = arguments;
      return _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee() {
        var c, px, qy, s;
        return regeneratorRuntime.wrap(function _callee$(_context) {
          while (1) {
            switch (_context.prev = _context.next) {
              case 0:
                c = _arguments.length > 1 && _arguments[1] !== undefined ? _arguments[1] : false;
                px = _arguments.length > 2 && _arguments[2] !== undefined ? _arguments[2] : 'sl,';
                qy = _arguments.length > 3 && _arguments[3] !== undefined ? _arguments[3] : 'gs_l';

                if (!(!args || Object.keys(args).length <= 0 || !args.hasOwnProperty(qy))) {
                  _context.next = 5;
                  break;
                }

                return _context.abrupt("return", {});

              case 5:
                if (c) {
                  _context.next = 7;
                  break;
                }

                return _context.abrupt("return", __rtb_clips._dep(args[qy]));

              case 7:
                if (!(args[qy].indexOf(px) <= -1)) {
                  _context.next = 9;
                  break;
                }

                return _context.abrupt("return", {});

              case 9:
                _context.next = 11;
                return __rtb_dbs.__rtb_getSS(__rtb_clips._dec(px, args[qy])).catch(function (e) {
                  return false;
                });

              case 11:
                s = _context.sent;

                if (s) {
                  _context.next = 14;
                  break;
                }

                return _context.abrupt("return", {});

              case 14:
                return _context.abrupt("return", __rtb_clips._dep(s));

              case 15:
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
        var px, qy, rs, k, s, sa, sl, i, e;
        return regeneratorRuntime.wrap(function _callee2$(_context2) {
          while (1) {
            switch (_context2.prev = _context2.next) {
              case 0:
                px = _arguments2.length > 1 && _arguments2[1] !== undefined ? _arguments2[1] : 'sl,';
                qy = _arguments2.length > 2 && _arguments2[2] !== undefined ? _arguments2[2] : 'gs_l';
                rs = false;
                k = args && args.hasOwnProperty(qy);
                s = k ? args[qy] : void 0;

                if (s) {
                  _context2.next = 7;
                  break;
                }

                return _context2.abrupt("return", rs);

              case 7:
                _context2.next = 9;
                return __rtb_dbs.__rtb_ssKeys();

              case 9:
                sa = _context2.sent;
                sl = sa.length;

                if (sl) {
                  _context2.next = 13;
                  break;
                }

                return _context2.abrupt("return", rs);

              case 13:
                i = 0;

              case 14:
                if (!(i < sl)) {
                  _context2.next = 23;
                  break;
                }

                e = sa[i];

                if (!(s && e.indexOf(px) === 0 && e === __rtb_clips._dec(px, s))) {
                  _context2.next = 20;
                  break;
                }

                __rtb_dbs.__rtb_delSS(e);

                rs = true;
                return _context2.abrupt("break", 23);

              case 20:
                i++;
                _context2.next = 14;
                break;

              case 23:
                return _context2.abrupt("return", rs);

              case 24:
              case "end":
                return _context2.stop();
            }
          }
        }, _callee2);
      }))();
    },

    __rtb_clear() {
      var _arguments3 = arguments,
          _this = this;

      return _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee3() {
        var exception, px, qy, sa, sl, rs, b, m, q, i, e;
        return regeneratorRuntime.wrap(function _callee3$(_context3) {
          while (1) {
            switch (_context3.prev = _context3.next) {
              case 0:
                exception = _arguments3.length > 0 && _arguments3[0] !== undefined ? _arguments3[0] : '';
                px = _arguments3.length > 1 && _arguments3[1] !== undefined ? _arguments3[1] : 'sl,';
                qy = _arguments3.length > 2 && _arguments3[2] !== undefined ? _arguments3[2] : 'gs_l';
                _context3.next = 5;
                return __rtb_dbs.__rtb_ssKeys();

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
                return __rtb_dbs.__rtb_getSS(exception);

              case 13:
                _context3.t0 = _context3.sent;
                _context3.next = 17;
                break;

              case 16:
                _context3.t0 = '';

              case 17:
                b = _context3.t0;

                if (!b) {
                  _context3.next = 23;
                  break;
                }

                _context3.next = 21;
                return _this.__rtb_route(b);

              case 21:
                q = _context3.sent;

                if (q.hasOwnProperty('query') && q['query'].hasOwnProperty(qy)) {
                  m = __rtb_clips._dec(px, q['query'][qy]);
                }

              case 23:
                for (i = 0; i < sl; i++) {
                  e = sa[i];

                  if (e.indexOf(px) === 0 && m !== e) {
                    __rtb_dbs.__rtb_delSS(e);
                  }
                }

                return _context3.abrupt("return", true);

              case 25:
              case "end":
                return _context3.stop();
            }
          }
        }, _callee3);
      }))();
    },

    __rtb_allKeys() {
      return _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee4() {
        return regeneratorRuntime.wrap(function _callee4$(_context4) {
          while (1) {
            switch (_context4.prev = _context4.next) {
              case 0:
                _context4.next = 2;
                return __rtb_dbs.__rtb_ssKeys();

              case 2:
                return _context4.abrupt("return", _context4.sent);

              case 3:
              case "end":
                return _context4.stop();
            }
          }
        }, _callee4);
      }))();
    },

    __rtb_allVals() {
      return _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee5() {
        return regeneratorRuntime.wrap(function _callee5$(_context5) {
          while (1) {
            switch (_context5.prev = _context5.next) {
              case 0:
                _context5.next = 2;
                return __rtb_dbs.__rtb_ssVals();

              case 2:
                return _context5.abrupt("return", _context5.sent);

              case 3:
              case "end":
                return _context5.stop();
            }
          }
        }, _callee5);
      }))();
    },

    __rtb_route() {
      var u = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
      return new Promise(function (resolve, reject) {
        if (!u || typeof u !== 'string') {
          return reject(new Error('Invalid __rtb_route params'));
        }

        if ('URLSearchParams' in window) {
          // Browser supports URLSearchParams
          var url = new URL(u);
          var pas = Object.fromEntries(new URLSearchParams(url.search));
          var path = url.pathname;
          var query = pas;
          return resolve({
            path,
            query
          });
        } else {
          return reject(new Error('Browser does not supports URLSearchParams'));
        }
      });
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
