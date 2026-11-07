const {getCdpConfig, readProfileNukeProgressFromWorker, runMain} = require('./lib/cdp')

// Counts the worker's profile progress records by status, and lists the non-terminal ones (a finished row should not leave one).
runMain(async () => {
    const records = await readProfileNukeProgressFromWorker(getCdpConfig())
    const map = records && typeof records === 'object' ? (records.records || records) : {}
    const counts = {}
    const open = []
    for (const [href, rec] of Object.entries(map)) {
        const status = (rec && rec.status) || 'none'
        counts[status] = (counts[status] || 0) + 1
        if (!['succeeded', 'failed', 'skipped', 'canceled', 'blocked', 'already-blocked', 'archived-terminal'].includes(status)) open.push({href, status})
    }
    console.log(JSON.stringify({total: Object.keys(map).length, counts, nonTerminal: open.length, nonTerminalList: open}, null, 2))
})
