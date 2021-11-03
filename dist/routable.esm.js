var t = typeof globalThis != "undefined" ? globalThis : typeof window != "undefined" ? window : typeof global != "undefined" ? global : typeof self != "undefined" ? self : {};
function n(e2) {
  return Array.prototype.slice.call(e2);
}
function r(e2) {
  return new Promise(function(t2, n2) {
    e2.onsuccess = function() {
      t2(e2.result);
    }, e2.onerror = function() {
      n2(e2.error);
    };
  });
}
function o(e2, t2, n2) {
  var o2, i2 = new Promise(function(i3, s2) {
    r(o2 = e2[t2].apply(e2, n2)).then(i3, s2);
  });
  return i2.request = o2, i2;
}
function i(e2, t2, n2) {
  var r2 = o(e2, t2, n2);
  return r2.then(function(e3) {
    if (e3)
      return new f(e3, r2.request);
  });
}
function s(e2, t2, n2) {
  n2.forEach(function(n3) {
    Object.defineProperty(e2.prototype, n3, { get: function() {
      return this[t2][n3];
    }, set: function(e3) {
      this[t2][n3] = e3;
    } });
  });
}
function a(e2, t2, n2, r2) {
  r2.forEach(function(r3) {
    r3 in n2.prototype && (e2.prototype[r3] = function() {
      return o(this[t2], r3, arguments);
    });
  });
}
function c(e2, t2, n2, r2) {
  r2.forEach(function(r3) {
    r3 in n2.prototype && (e2.prototype[r3] = function() {
      return this[t2][r3].apply(this[t2], arguments);
    });
  });
}
function u(e2, t2, n2, r2) {
  r2.forEach(function(r3) {
    r3 in n2.prototype && (e2.prototype[r3] = function() {
      return i(this[t2], r3, arguments);
    });
  });
}
function l(e2) {
  this._index = e2;
}
function f(e2, t2) {
  this._cursor = e2, this._request = t2;
}
function h(e2) {
  this._store = e2;
}
function p(e2) {
  this._tx = e2, this.complete = new Promise(function(t2, n2) {
    e2.oncomplete = function() {
      t2();
    }, e2.onerror = function() {
      n2(e2.error);
    }, e2.onabort = function() {
      n2(e2.error);
    };
  });
}
function d(e2, t2, n2) {
  this._db = e2, this.oldVersion = t2, this.transaction = new p(n2);
}
function _(e2) {
  this._db = e2;
}
if (function(t2) {
  var n2, r2, o2, i2, s2;
  if (o2 = t2.IDBObjectStore || t2.webkitIDBObjectStore || t2.mozIDBObjectStore || t2.msIDBObjectStore, r2 = t2.IDBIndex || t2.webkitIDBIndex || t2.mozIDBIndex || t2.msIDBIndex, o2 !== void 0 && r2 !== void 0) {
    var a2 = false;
    typeof WorkerGlobalScope != "undefined" && (navigator.userAgent.indexOf("Safari/602") >= 0 || navigator.userAgent.indexOf("Safari/603") >= 0) && (a2 = true), (a2 || o2.prototype.getAll === void 0 || r2.prototype.getAll === void 0 || o2.prototype.getAllKeys === void 0 || r2.prototype.getAllKeys === void 0) && (i2 = function() {
      this.result = null, this.error = null, this.source = null, this.transaction = null, this.readyState = "pending", this.onsuccess = null, this.onerror = null, this.toString = function() {
        return "[object IDBRequest]";
      }, this._listeners = { success: [], error: [] };
      var e2 = this;
      this.addEventListener = function(t3, n3) {
        e2._listeners[t3] && e2._listeners[t3].push(n3);
      }, this.removeEventListener = function(t3, n3) {
        e2._listeners[t3] && (e2._listeners[t3] = e2._listeners[t3].filter(function(e3) {
          return n3 !== e3;
        }));
      };
    }, n2 = function(e2) {
      this.type = e2, this.target = null, this.currentTarget = null, this.NONE = 0, this.CAPTURING_PHASE = 1, this.AT_TARGET = 2, this.BUBBLING_PHASE = 3, this.eventPhase = this.NONE, this.stopPropagation = function() {
        console.log("stopPropagation not implemented in IndexedDB-getAll-shim");
      }, this.stopImmediatePropagation = function() {
        console.log("stopImmediatePropagation not implemented in IndexedDB-getAll-shim");
      }, this.bubbles = false, this.cancelable = false, this.preventDefault = function() {
        console.log("preventDefault not implemented in IndexedDB-getAll-shim");
      }, this.defaultPrevented = false, this.isTrusted = false, this.timestamp = Date.now();
    }, s2 = function(t3, r3) {
      return function(o3, s3) {
        var a3, c2, u2;
        return o3 = o3 !== void 0 ? o3 : null, c2 = new i2(), u2 = [], (a3 = this.openCursor(o3)).onsuccess = function(e2) {
          var o4, i3, a4, l2;
          if ((o4 = e2.target.result) && (l2 = r3 === "value" ? o4.value : t3 === "index" ? o4.primaryKey : o4.key, u2.push(l2), s3 === void 0 || u2.length < s3))
            o4.continue();
          else if (c2.result = u2, (i3 = new n2("success")).target = { readyState: "done", result: u2 }, typeof c2.onsuccess == "function" && c2.onsuccess(i3), c2._listeners.success.length > 0)
            for (a4 = 0; a4 < c2._listeners.success.length; a4++)
              c2._listeners.success[a4](i3);
        }, a3.onerror = function(t4) {
          var n3;
          if (console.log("IndexedDB-getAll-shim error when getting data:", t4.target.error), typeof c2.onerror == "function" && c2.onerror(t4), c2._listeners.error.length > 0)
            for (n3 = 0; n3 < c2._listeners.error.length; n3++)
              c2._listeners.error[n3](e);
        }, c2;
      };
    }, (a2 || o2.prototype.getAll === void 0) && (o2.prototype.getAll = s2("objectStore", "value")), (a2 || r2.prototype.getAll === void 0) && (r2.prototype.getAll = s2("index", "value")), (a2 || o2.prototype.getAllKeys === void 0) && (o2.prototype.getAllKeys = s2("objectStore", "key")), (a2 || r2.prototype.getAllKeys === void 0) && (r2.prototype.getAllKeys = s2("index", "key")));
  }
}(typeof window != "undefined" ? window : typeof WorkerGlobalScope != "undefined" ? self : t !== void 0 ? t : Function("return this;")()), s(l, "_index", ["name", "keyPath", "multiEntry", "unique"]), a(l, "_index", IDBIndex, ["get", "getKey", "getAll", "getAllKeys", "count"]), u(l, "_index", IDBIndex, ["openCursor", "openKeyCursor"]), s(f, "_cursor", ["direction", "key", "primaryKey", "value"]), a(f, "_cursor", IDBCursor, ["update", "delete"]), ["advance", "continue", "continuePrimaryKey"].forEach(function(e2) {
  e2 in IDBCursor.prototype && (f.prototype[e2] = function() {
    var t2 = this, n2 = arguments;
    return Promise.resolve().then(function() {
      return t2._cursor[e2].apply(t2._cursor, n2), r(t2._request).then(function(e3) {
        if (e3)
          return new f(e3, t2._request);
      });
    });
  });
}), h.prototype.createIndex = function() {
  return new l(this._store.createIndex.apply(this._store, arguments));
}, h.prototype.index = function() {
  return new l(this._store.index.apply(this._store, arguments));
}, s(h, "_store", ["name", "keyPath", "indexNames", "autoIncrement"]), a(h, "_store", IDBObjectStore, ["put", "add", "delete", "clear", "get", "getAll", "getKey", "getAllKeys", "count"]), u(h, "_store", IDBObjectStore, ["openCursor", "openKeyCursor"]), c(h, "_store", IDBObjectStore, ["deleteIndex"]), p.prototype.objectStore = function() {
  return new h(this._tx.objectStore.apply(this._tx, arguments));
}, s(p, "_tx", ["objectStoreNames", "mode"]), c(p, "_tx", IDBTransaction, ["abort"]), d.prototype.createObjectStore = function() {
  return new h(this._db.createObjectStore.apply(this._db, arguments));
}, s(d, "_db", ["name", "version", "objectStoreNames"]), c(d, "_db", IDBDatabase, ["deleteObjectStore", "close"]), _.prototype.transaction = function() {
  return new p(this._db.transaction.apply(this._db, arguments));
}, s(_, "_db", ["name", "version", "objectStoreNames"]), c(_, "_db", IDBDatabase, ["close"]), ["openCursor", "openKeyCursor"].forEach(function(e2) {
  [h, l].forEach(function(t2) {
    e2 in t2.prototype && (t2.prototype[e2.replace("open", "iterate")] = function() {
      var t3 = n(arguments), r2 = t3[t3.length - 1], o2 = this._store || this._index, i2 = o2[e2].apply(o2, t3.slice(0, -1));
      i2.onsuccess = function() {
        r2(i2.result);
      };
    });
  });
}), [l, h].forEach(function(e2) {
  e2.prototype.getAll || (e2.prototype.getAll = function(e3, t2) {
    var n2 = this, r2 = [];
    return new Promise(function(o2) {
      n2.iterateCursor(e3, function(e4) {
        e4 ? (r2.push(e4.value), t2 === void 0 || r2.length != t2 ? e4.continue() : o2(r2)) : o2(r2);
      });
    });
  });
}), [l, h].forEach(function(e2) {
  e2.prototype.getAllKeys || (e2.prototype.getAllKeys = function(e3, t2) {
    var n2 = this, r2 = [];
    return new Promise(function(o2) {
      n2.iterateCursor(e3, function(e4) {
        e4 ? (r2.push(e4.key), t2 === void 0 || r2.length != t2 ? e4.continue() : o2(r2)) : o2(r2);
      });
    });
  });
}), !("indexedDB" in window))
  throw new Error("Fatal error: the browser does not support indexedDb");
const y = "__rtb_db_table", b = (g = (e2) => {
  e2.createObjectStore(y);
}, m = o(indexedDB, "open", ["__rtb_db_routable", 1]), (v = m.request) && (v.onupgradeneeded = function(e2) {
  g && g(new d(v.result, e2.oldVersion, v.transaction));
}), m.then(function(e2) {
  return new _(e2);
}));
var g, m, v, w = { async __rtb_setSS(e2, t2) {
  const n2 = (await b).transaction(y, "readwrite");
  return n2.objectStore(y).put(t2, e2), n2.complete;
}, __rtb_getSS: async (e2) => (await b).transaction(y).objectStore(y).get(e2), async __rtb_delSS(e2) {
  const t2 = (await b).transaction(y, "readwrite");
  return t2.objectStore(y).delete(e2), t2.complete;
}, async __rtb_clearSS() {
  const e2 = (await b).transaction(y, "readwrite");
  return e2.objectStore(y).clear(), e2.complete;
}, __rtb_ssKeys: async () => (await b).transaction(y).objectStore(y).getAllKeys(), __rtb_ssVals: async () => (await b).transaction(y).objectStore(y).getAll() }, S = { _gen: function(e2 = 32) {
  return this._ren(new Date().getTime().toString(e2));
}, _ren: function(e2) {
  if (!e2 || !e2.length)
    return e2;
  let t2 = e2.split(""), n2 = [];
  for (; t2.length; ) {
    let e3 = t2.shift();
    n2.unshift(Math.random() > 0.6 ? e3.toUpperCase() : e3);
  }
  return n2.join("");
}, _enc: function(e2, t2, n2 = ".") {
  return e2 + t2.split("").reverse().join(n2);
}, _dec: function(e2, t2, n2 = ".") {
  return e2 + this._enb(t2.slice(e2.length).split(n2).reverse().join(""));
}, _enp: function(e2) {
  return btoa(encodeURIComponent(JSON.stringify(e2)));
}, _dep: function(e2) {
  return JSON.parse(decodeURIComponent(atob(e2)));
}, _enb: function(e2) {
  return btoa(e2);
}, _deb: function(e2) {
  return atob(e2);
} };
!function(e2) {
  var t2 = function() {
    try {
      return !!Symbol.iterator;
    } catch (e3) {
      return false;
    }
  }(), n2 = function(e3) {
    var n3 = { next: function() {
      var t3 = e3.shift();
      return { done: t3 === void 0, value: t3 };
    } };
    return t2 && (n3[Symbol.iterator] = function() {
      return n3;
    }), n3;
  }, r2 = function(e3) {
    return encodeURIComponent(e3).replace(/%20/g, "+");
  }, o2 = function(e3) {
    return decodeURIComponent(String(e3).replace(/\+/g, " "));
  };
  (function() {
    try {
      var t3 = e2.URLSearchParams;
      return new t3("?a=1").toString() === "a=1" && typeof t3.prototype.set == "function" && typeof t3.prototype.entries == "function";
    } catch (e3) {
      return false;
    }
  })() || function() {
    var o3 = function(e3) {
      Object.defineProperty(this, "_entries", { writable: true, value: {} });
      var t3 = typeof e3;
      if (t3 === "undefined")
        ;
      else if (t3 === "string")
        e3 !== "" && this._fromString(e3);
      else if (e3 instanceof o3) {
        var n3 = this;
        e3.forEach(function(e4, t4) {
          n3.append(t4, e4);
        });
      } else {
        if (e3 === null || t3 !== "object")
          throw new TypeError("Unsupported input's type for URLSearchParams");
        if (Object.prototype.toString.call(e3) === "[object Array]")
          for (var r3 = 0; r3 < e3.length; r3++) {
            var i4 = e3[r3];
            if (Object.prototype.toString.call(i4) !== "[object Array]" && i4.length === 2)
              throw new TypeError("Expected [string, any] as entry at index " + r3 + " of URLSearchParams's input");
            this.append(i4[0], i4[1]);
          }
        else
          for (var s2 in e3)
            e3.hasOwnProperty(s2) && this.append(s2, e3[s2]);
      }
    }, i3 = o3.prototype;
    i3.append = function(e3, t3) {
      e3 in this._entries ? this._entries[e3].push(String(t3)) : this._entries[e3] = [String(t3)];
    }, i3.delete = function(e3) {
      delete this._entries[e3];
    }, i3.get = function(e3) {
      return e3 in this._entries ? this._entries[e3][0] : null;
    }, i3.getAll = function(e3) {
      return e3 in this._entries ? this._entries[e3].slice(0) : [];
    }, i3.has = function(e3) {
      return e3 in this._entries;
    }, i3.set = function(e3, t3) {
      this._entries[e3] = [String(t3)];
    }, i3.forEach = function(e3, t3) {
      var n3;
      for (var r3 in this._entries)
        if (this._entries.hasOwnProperty(r3)) {
          n3 = this._entries[r3];
          for (var o4 = 0; o4 < n3.length; o4++)
            e3.call(t3, n3[o4], r3, this);
        }
    }, i3.keys = function() {
      var e3 = [];
      return this.forEach(function(t3, n3) {
        e3.push(n3);
      }), n2(e3);
    }, i3.values = function() {
      var e3 = [];
      return this.forEach(function(t3) {
        e3.push(t3);
      }), n2(e3);
    }, i3.entries = function() {
      var e3 = [];
      return this.forEach(function(t3, n3) {
        e3.push([n3, t3]);
      }), n2(e3);
    }, t2 && (i3[Symbol.iterator] = i3.entries), i3.toString = function() {
      var e3 = [];
      return this.forEach(function(t3, n3) {
        e3.push(r2(n3) + "=" + r2(t3));
      }), e3.join("&");
    }, e2.URLSearchParams = o3;
  }();
  var i2 = e2.URLSearchParams.prototype;
  typeof i2.sort != "function" && (i2.sort = function() {
    var e3 = this, t3 = [];
    this.forEach(function(n4, r3) {
      t3.push([r3, n4]), e3._entries || e3.delete(r3);
    }), t3.sort(function(e4, t4) {
      return e4[0] < t4[0] ? -1 : e4[0] > t4[0] ? 1 : 0;
    }), e3._entries && (e3._entries = {});
    for (var n3 = 0; n3 < t3.length; n3++)
      this.append(t3[n3][0], t3[n3][1]);
  }), typeof i2._fromString != "function" && Object.defineProperty(i2, "_fromString", { enumerable: false, configurable: false, writable: false, value: function(e3) {
    if (this._entries)
      this._entries = {};
    else {
      var t3 = [];
      this.forEach(function(e4, n4) {
        t3.push(n4);
      });
      for (var n3 = 0; n3 < t3.length; n3++)
        this.delete(t3[n3]);
    }
    var r3, i3 = (e3 = e3.replace(/^\?/, "")).split("&");
    for (n3 = 0; n3 < i3.length; n3++)
      r3 = i3[n3].split("="), this.append(o2(r3[0]), r3.length > 1 ? o2(r3[1]) : "");
  } });
}(t !== void 0 ? t : typeof window != "undefined" ? window : typeof self != "undefined" ? self : t), function(e2) {
  if (function() {
    try {
      var t3 = new e2.URL("b", "http://a");
      return t3.pathname = "c d", t3.href === "http://a/c%20d" && t3.searchParams;
    } catch (e3) {
      return false;
    }
  }() || function() {
    var t3 = e2.URL, n2 = function(t4, n3) {
      typeof t4 != "string" && (t4 = String(t4)), n3 && typeof n3 != "string" && (n3 = String(n3));
      var r3, o2 = document;
      if (n3 && (e2.location === void 0 || n3 !== e2.location.href)) {
        n3 = n3.toLowerCase(), (r3 = (o2 = document.implementation.createHTMLDocument("")).createElement("base")).href = n3, o2.head.appendChild(r3);
        try {
          if (r3.href.indexOf(n3) !== 0)
            throw new Error(r3.href);
        } catch (e3) {
          throw new Error("URL unable to set base " + n3 + " due to " + e3);
        }
      }
      var i2 = o2.createElement("a");
      i2.href = t4, r3 && (o2.body.appendChild(i2), i2.href = i2.href);
      var s2 = o2.createElement("input");
      if (s2.type = "url", s2.value = t4, i2.protocol === ":" || !/:/.test(i2.href) || !s2.checkValidity() && !n3)
        throw new TypeError("Invalid URL");
      Object.defineProperty(this, "_anchorElement", { value: i2 });
      var a2 = new e2.URLSearchParams(this.search), c2 = true, u2 = true, l2 = this;
      ["append", "delete", "set"].forEach(function(e3) {
        var t5 = a2[e3];
        a2[e3] = function() {
          t5.apply(a2, arguments), c2 && (u2 = false, l2.search = a2.toString(), u2 = true);
        };
      }), Object.defineProperty(this, "searchParams", { value: a2, enumerable: true });
      var f2 = void 0;
      Object.defineProperty(this, "_updateSearchParams", { enumerable: false, configurable: false, writable: false, value: function() {
        this.search !== f2 && (f2 = this.search, u2 && (c2 = false, this.searchParams._fromString(this.search), c2 = true));
      } });
    }, r2 = n2.prototype;
    ["hash", "host", "hostname", "port", "protocol"].forEach(function(e3) {
      !function(e4) {
        Object.defineProperty(r2, e4, { get: function() {
          return this._anchorElement[e4];
        }, set: function(t4) {
          this._anchorElement[e4] = t4;
        }, enumerable: true });
      }(e3);
    }), Object.defineProperty(r2, "search", { get: function() {
      return this._anchorElement.search;
    }, set: function(e3) {
      this._anchorElement.search = e3, this._updateSearchParams();
    }, enumerable: true }), Object.defineProperties(r2, { toString: { get: function() {
      var e3 = this;
      return function() {
        return e3.href;
      };
    } }, href: { get: function() {
      return this._anchorElement.href.replace(/\?$/, "");
    }, set: function(e3) {
      this._anchorElement.href = e3, this._updateSearchParams();
    }, enumerable: true }, pathname: { get: function() {
      return this._anchorElement.pathname.replace(/(^\/?)/, "/");
    }, set: function(e3) {
      this._anchorElement.pathname = e3;
    }, enumerable: true }, origin: { get: function() {
      var e3 = { "http:": 80, "https:": 443, "ftp:": 21 }[this._anchorElement.protocol], t4 = this._anchorElement.port != e3 && this._anchorElement.port !== "";
      return this._anchorElement.protocol + "//" + this._anchorElement.hostname + (t4 ? ":" + this._anchorElement.port : "");
    }, enumerable: true }, password: { get: function() {
      return "";
    }, set: function(e3) {
    }, enumerable: true }, username: { get: function() {
      return "";
    }, set: function(e3) {
    }, enumerable: true } }), n2.createObjectURL = function(e3) {
      return t3.createObjectURL.apply(t3, arguments);
    }, n2.revokeObjectURL = function(e3) {
      return t3.revokeObjectURL.apply(t3, arguments);
    }, e2.URL = n2;
  }(), e2.location !== void 0 && !("origin" in e2.location)) {
    var t2 = function() {
      return e2.location.protocol + "//" + e2.location.hostname + (e2.location.port ? ":" + e2.location.port : "");
    };
    try {
      Object.defineProperty(e2.location, "origin", { get: t2, enumerable: true });
    } catch (n2) {
      setInterval(function() {
        e2.location.origin = t2();
      }, 100);
    }
  }
}(t !== void 0 ? t : typeof window != "undefined" ? window : typeof self != "undefined" ? self : t);
const E = (e2, t2) => w.__rtb_setSS(e2, t2), j = (e2) => w.__rtb_getSS(e2), P = (e2, t2 = false, n2 = 32, r2 = "sl,", o2 = "gs_l") => {
  if (!e2 || e2.length <= 0)
    return "";
  if (!t2) {
    let t3 = Object.prototype.constructor();
    return t3[o2] = S._enp(e2), t3;
  }
  const i2 = S._gen(n2);
  E(r2 + S._enb(i2), S._enp(e2));
  let s2 = Object.prototype.constructor();
  return s2[o2] = S._enc(r2, i2), s2;
}, O = async (e2, t2 = false, n2 = "sl,", r2 = "gs_l") => {
  if (!e2 || Object.keys(e2).length <= 0 || !e2.hasOwnProperty(r2))
    return {};
  if (!t2)
    return S._dep(e2[r2]);
  if (!e2[r2].includes(n2))
    return {};
  let o2 = await w.__rtb_getSS(S._dec(n2, e2[r2])).catch((e3) => false);
  return o2 ? S._dep(o2) : {};
}, I = async (e2, t2 = "sl,", n2 = "gs_l") => {
  let r2 = false, o2 = e2 && e2.hasOwnProperty(n2) ? e2[n2] : void 0;
  if (!o2)
    return r2;
  let i2 = await w.__rtb_ssKeys(), s2 = i2.length;
  if (!s2)
    return r2;
  for (let e3 = 0; e3 < s2; e3++) {
    const n3 = i2[e3];
    if (o2 && A(n3) && n3 === S._dec(t2, o2)) {
      w.__rtb_delSS(n3), r2 = true;
      break;
    }
  }
  return r2;
}, x = async (e2 = "", t2 = "sl,", n2 = "gs_l") => {
  let r2 = await w.__rtb_ssKeys(), o2 = r2.length;
  if (!o2)
    return true;
  let i2, s2 = e2 ? await w.__rtb_getSS(e2) : "";
  if (s2) {
    const e3 = await U(s2);
    e3.hasOwnProperty("query") && e3.query.hasOwnProperty(n2) && (i2 = S._dec(t2, e3.query[n2]));
  }
  for (let e3 = 0; e3 < o2; e3++) {
    const t3 = r2[e3];
    A(t3) && i2 !== t3 && w.__rtb_delSS(t3);
  }
  return true;
}, A = (e2, t2 = "sl,") => Object.prototype.toString.call(e2) === "[object String]" && e2.length >= 3 && e2.slice(0, 3) === t2, D = async () => await w.__rtb_ssKeys(), B = async () => await w.__rtb_ssVals(), U = (e2 = "") => new Promise((t2, n2) => {
  if (!e2 || typeof e2 != "string")
    return n2(new Error("Invalid __rtb_route params"));
  if ("URLSearchParams" in window) {
    const n3 = new URL(e2), o2 = (r2 = new URLSearchParams(n3.search), typeof Object.fromEntries == "function" ? Object.fromEntries(r2) : [...r2].reduce((e3, [t3, n4]) => (e3[t3] = n4, e3), {}));
    return t2({ path: n3.pathname, query: o2 });
  }
  return n2(new Error("Browser does not supports URLSearchParams"));
  var r2;
}), R = { __rtb_erase: P, __rtb_record: O, __rtb_flush: I, __rtb_clear: x, __rtb_set: E, __rtb_get: j, __rtb_allKeys: D, __rtb_allVals: B, __rtb_route: U };
export { D as __rtb_allKeys, B as __rtb_allVals, x as __rtb_clear, P as __rtb_erase, I as __rtb_flush, j as __rtb_get, O as __rtb_record, U as __rtb_route, E as __rtb_set, R as default };
