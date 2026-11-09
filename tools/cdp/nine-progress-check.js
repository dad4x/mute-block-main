const fs = require('fs')
const {getCdpConfig, readProfileNukeProgressFromWorker, runMain} = require('./lib/cdp')

// Reads the worker's profile progress for the profiles listed in a JSON file, and reports each one's record (or none).
runMain(async () => {
    const config = getCdpConfig()
    const hrefs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).map(o => o.href)
    const progress = await readProfileNukeProgressFromWorker(config)
    const records = progress && typeof progress === 'object' ? (progress.records || progress) : {}
    const out = hrefs.map(href => {
        const rec = records[href] || null
        return {href, record: rec ? {status: rec.status || '', outcome: rec.outcome || '', event: String(rec.event || '').slice(0, 60), terminalAt: rec.terminalAt || 0} : null}
    })
    console.log(JSON.stringify({totalRecords: Object.keys(records).length, nine: out}, null, 2))
})
