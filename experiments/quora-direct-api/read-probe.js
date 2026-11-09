// Read-only probe: find a profile's numeric uid from the page's own data, then time the followers query
// (UserProfileFollowersModalQuery, a read) sent from the same tab. No mutation hashes are used.
// Opens its own background tab and closes only that tab at the end.
const {cdpCommand, evaluate, getCdpConfig, getJson, getTargets, runMain, sleep} = require('../../tools/cdp/lib/cdp')

const PROFILE = process.env.PROBE_PROFILE || 'https://www.quora.com/profile/Terence-Daly-7'
const FOLLOWERS_HASH = 'e92dcb2fdc01dacffb61e9beac5a90cca4d6a2d8a715667c8600788725db8a1b'

const pageProbe = `(async () => {
    const html = document.documentElement.innerHTML
    const rootAt = html.indexOf('rootQueryVariables')
    const rootUid = rootAt < 0 ? undefined : (html.slice(rootAt, rootAt + 200).match(/uid[^0-9]{1,8}([0-9]{4,})/) || [])[1]
    const formkey = window.ansFrontendGlobals?.earlySettings?.formkey || (html.match(/"formkey": ?"([^"]+)"/) || [])[1] || null
    const candidates = rootUid ? [{uid: Number(rootUid), source: "rootQueryVariables"}] : []
    const send = async (uid) => {
        const started = performance.now()
        const res = await fetch('https://www.quora.com/graphql/gql_POST?q=UserProfileFollowersModalQuery', {
            method: 'POST',
            credentials: 'include',
            headers: {'Content-Type': 'application/json', ...(formkey ? {'Quora-Formkey': formkey} : {})},
            body: JSON.stringify({queryName: 'UserProfileFollowersModalQuery', variables: {uid}, extensions: {hash: '${FOLLOWERS_HASH}'}})
        })
        const text = await res.text()
        return {status: res.status, ms: Math.round(performance.now() - started), bytes: text.length, head: text.slice(0, 160)}
    }
    const tries = []
    for (const c of candidates) tries.push({uid: c.uid, source: c.source, result: await send(c.uid)})
    const best = tries.find(t => t.result.status === 200)
    const timings = []
    if (best) for (let i = 0; i < 5; i += 1) timings.push((await send(best.uid)).ms)
    return {url: location.href, title: document.title, formkeyFound: Boolean(formkey), candidates, tries, bestUid: best ? best.uid : null, repeatMs: timings}
})()`

runMain(async () => {
    const config = getCdpConfig()
    const version = await getJson('/json/version', config)
    const created = await cdpCommand(version.webSocketDebuggerUrl, 'Target.createTarget', {url: PROFILE, background: true})
    const targetId = created.targetId
    let target = null
    for (let i = 0; i < 60 && !target; i += 1) {
        await sleep(500)
        target = (await getTargets(config)).find(t => t.id === targetId)
    }
    if (!target) throw new Error('probe tab did not appear')
    await sleep(8000)
    const result = await evaluate(target.webSocketDebuggerUrl, pageProbe, 120000)
    console.log(JSON.stringify(result, null, 2))
    await cdpCommand(version.webSocketDebuggerUrl, 'Target.closeTarget', {targetId})
})
