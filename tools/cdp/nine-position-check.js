const fs = require('fs')
const {evaluate, getCdpConfig, getTargets, resolveCdpConfig, runMain} = require('./lib/cdp')

// Where each listed profile's link sits in the page's document order, among all profile links, and how far down the page it is.
function profilePositions(list) {
    const all = Array.from(document.querySelectorAll('a[href*="/profile/"]'))
    const slugOf = a => (a.getAttribute('href') || '').split('?')[0].replace(/\/$/, '').split('/profile/')[1] || ''
    const docHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
    return {
        totalLinks: all.length,
        scrollY: Math.round(window.scrollY),
        docHeight,
        nine: list.map(href => {
            const slug = href.split('/profile/')[1]
            const hits = all.map((a, i) => ({i, a})).filter(x => slugOf(x.a) === slug)
            return hits.map(({i, a}) => ({
                indexInDocument: i,
                fractionOfLinks: Number((i / Math.max(1, all.length - 1)).toFixed(3)),
                topPx: Math.round(a.getBoundingClientRect().top + window.scrollY),
                fractionOfPage: Number(((a.getBoundingClientRect().top + window.scrollY) / docHeight).toFixed(3))
            }))
        })
    }
}

runMain(async () => {
    const config = await resolveCdpConfig(getCdpConfig())
    const hrefs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).map(o => o.href)
    const targets = await getTargets(config)
    const page = targets.find(t => t.type === 'page' && (t.url || '').includes('trollsgalore.quora.com'))
    if (!page) throw new Error('no trollsgalore page open')
    const out = await evaluate(page.webSocketDebuggerUrl, `(${profilePositions.toString()})(${JSON.stringify(hrefs)})`, 20000)
    console.log(JSON.stringify(out, null, 2))
})
