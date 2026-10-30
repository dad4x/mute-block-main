const fs = require('fs')
const {evaluate, getCdpConfig, getTargets, resolveCdpConfig, runMain} = require('./lib/cdp')

// Reads, on the space page, where each listed profile's link sits: whether it is in a post, whether that post is collapsed, and whether it has a "more" control.
function inspectSpaceProfiles(list) {
    return list.map(href => {
        const slug = href.split('/profile/')[1]
        const anchors = Array.from(document.querySelectorAll('a[href*="/profile/"]'))
            .filter(a => (a.getAttribute('href') || '').split('?')[0].replace(/\/$/, '').endsWith('/profile/' + slug))
        return {
            href,
            anchors: anchors.length,
            places: anchors.slice(0, 3).map(a => {
                const post = a.closest('article, [role="article"], [class*="post"]') || a.parentElement
                const more = Array.from(post ? post.querySelectorAll('button, [role="button"], span') : [])
                    .filter(b => /^(more|show more|see more)$/i.test((b.innerText || '').trim())).length
                return {
                    collapsedClass: /collapsed|truncat/i.test((post && post.className) || ''),
                    moreControls: more,
                    textStart: ((post && post.innerText) || '').slice(0, 120).replace(/\s+/g, ' ')
                }
            })
        }
    })
}

runMain(async () => {
    const config = await resolveCdpConfig(getCdpConfig())
    const hrefs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).map(o => o.href)
    const targets = await getTargets(config)
    const page = targets.find(t => t.type === 'page' && (t.url || '').includes('trollsgalore.quora.com'))
    if (!page) throw new Error('no trollsgalore page open')
    const out = await evaluate(page.webSocketDebuggerUrl, `(${inspectSpaceProfiles.toString()})(${JSON.stringify(hrefs)})`, 20000)
    console.log(JSON.stringify(out, null, 2))
})
