// Checks whether sqlite-wasm's oo1 API completes synchronously once initialised,
// which is the property the fake-timer test harness needs. Prints a JSON summary.
import sqliteInit from '@sqlite.org/sqlite-wasm'

const sqlite3 = await sqliteInit({print: () => {}, printErr: () => {}})
const db = new sqlite3.oo1.DB(':memory:', 'c')
db.exec('CREATE TABLE rows(key TEXT PRIMARY KEY, seq INTEGER)')

const returned = db.exec({sql: 'INSERT INTO rows(key, seq) VALUES (?, ?)', bind: ['a', 1]})
const visibleImmediately = db.selectValue('SELECT COUNT(*) FROM rows') === 1

db.exec('BEGIN')
db.exec({sql: 'INSERT INTO rows(key, seq) VALUES (?, ?)', bind: ['b', 2]})
const insideTxCount = db.selectValue('SELECT COUNT(*) FROM rows')
db.exec('ROLLBACK')
const afterRollbackCount = db.selectValue('SELECT COUNT(*) FROM rows')

console.log(JSON.stringify({
    libVersion: sqlite3.version.libVersion,
    execReturnsDb: returned === db,
    writeVisibleWithoutAwait: visibleImmediately,
    rollbackRestoresCount: insideTxCount === 2 && afterRollbackCount === 1,
    insideTxCount,
    afterRollbackCount
}, null, 2))
db.close()
