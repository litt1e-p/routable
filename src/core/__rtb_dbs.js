import { openDb } from './__rtb_idb.polyfill.js'

if (!('indexedDB' in window)) {
  throw new Error('Fatal error: the browser does not support indexedDb');
}
const _dbName = '__rtb_db_routable';
const _tbName = '__rtb_db_table';
const _db = openDb(_dbName, 1, db => {
  db.createObjectStore(_tbName)
})

export default {
  async __rtb_setSS (k, v) {
    const db = await _db;
    const tx = db.transaction(_tbName, 'readwrite');
    tx.objectStore(_tbName).put(v, k);
    return tx.complete;
  },
  async __rtb_getSS (k) {
    const db = await _db;
    return db.transaction(_tbName).objectStore(_tbName).get(k);
  },
  async __rtb_delSS (k) {
    const db = await _db;
    const tx = db.transaction(_tbName, 'readwrite');
    tx.objectStore(_tbName).delete(k);
    return tx.complete;
  },
  async __rtb_clearSS () {
    const db = await _db;
    const tx = db.transaction(_tbName, 'readwrite');
    tx.objectStore(_tbName).clear();
    return tx.complete;
  },
  async __rtb_ssKeys () {
    const db = await _db;
    return db.transaction(_tbName).objectStore(_tbName).getAllKeys();
  },
  async __rtb_ssVals () {
    const db = await _db;
    return db.transaction(_tbName).objectStore(_tbName).getAll();
  }
}