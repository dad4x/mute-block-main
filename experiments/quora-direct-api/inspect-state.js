// Read-only: where does a Quora profile page keep its user id and form key? No requests are sent.
const {cdpCommand, evaluate, getCdpConfig, getJson, getTargets, runMain, sleep} = require('../../tools/cdp/lib/cdp')
const PROFILE = process.env.PROBE_PROFILE || 'https://www.quora.com/profile/Terence-Daly-7'
const inspect = `(() => {
    const html = document.documentElement.innerHTML
    const hits = (re) => (html.match(re) || []).length
    const sample = (re) => { const m = html.match(re); if (!m) return null; const i = m.index; return html.slice(Math.max(0, i - 60), i + 120) }
    const globals = Object.keys(window).filter(k => /apollo|relay|quora|formkey|__|state|store|ql$/i.test(k)).slice(0, 40)
    const scripts = document.querySelectorAll('script').length
    const scriptJson = Array.from(document.querySelectorAll('script[type="application/json"], script[id]')).map(s => s.id || s.type).slice(0, 20)
    const cookieNames = document.cookie.split(';').map(c => c.split('=')[0].trim()).filter(Boolean)
    return {
        htmlLength: html.length,
        uidMentions: hits(/uid/g),
        escapedUidMentions: hits(/\\\\"uid\\\\"/g),
        entityUidMentions: hits(/&quot;uid&quot;/g),
        uidSample: sample(/uid/),
        formkeyMentions: hits(/formkey/gi),
        formkeySample: sample(/formkey/i),
        globals,
        scriptCount: scripts,
        jsonScripts: scriptJson,
        cookieNames
    }
})()`
runMain(async () => {
    const config = getCdpConfig()
    const version = await getJson('/json/version', config)
    const created = await cdpCommand(version.webSocketDebuggerUrl, 'Target.createTarget', {url: PROFILE, background: true})
    let target = null
    for (let i = 0; i < 60 && !target; i += 1) { await sleep(500); target = (await getTargets(config)).find(t => t.id === created.targetId) }
    if (!target) throw new Error('probe tab did not appear')
    await sleep(8000)
    console.log(JSON.stringify(await evaluate(target.webSocketDebuggerUrl, inspect, 60000), null, 2))
    await cdpCommand(version.webSocketDebuggerUrl, 'Target.closeTarget', {targetId: created.targetId})
})
