const fs = require('fs')
const path = require('path')

function getOption(name, fallback = '') {
    const prefix = `--${name}=`
    const match = process.argv.find(arg => arg.startsWith(prefix))
    if(match) return match.slice(prefix.length)

    const index = process.argv.indexOf(`--${name}`)
    if(index >= 0 && process.argv[index + 1]) return process.argv[index + 1]

    return fallback
}

function uniquePush(array, value) {
    if(!array.includes(value)) array.push(value)
}

const sourceDir = path.resolve(getOption('source', 'firefox'))
const outDir = path.resolve(getOption('out', '/tmp/mute-block-firefox-mock'))
const mockMatch = getOption('match', 'http://127.0.0.1:*/*')
const mockPermission = getOption('permission', 'http://127.0.0.1:*/*')

if(!fs.existsSync(path.join(sourceDir, 'manifest.json'))) {
    throw new Error(`source manifest not found under ${sourceDir}`)
}

fs.rmSync(outDir, {recursive: true, force: true})
fs.cpSync(sourceDir, outDir, {recursive: true})

const manifestPath = path.join(outDir, 'manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

for(const script of manifest.content_scripts || []) {
    script.matches = script.matches || []
    uniquePush(script.matches, mockMatch)
}

manifest.host_permissions = manifest.host_permissions || []
uniquePush(manifest.host_permissions, mockPermission)

for(const resource of manifest.web_accessible_resources || []) {
    resource.matches = resource.matches || []
    uniquePush(resource.matches, mockMatch)
}

manifest.name = `${manifest.name || 'Mute Block'} Mock`
manifest.description = `${manifest.description || ''} Local mock-harness build; not for packaging.`.trim()

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`)

console.log(JSON.stringify({
    ok: true,
    sourceDir,
    outDir,
    manifestPath,
    mockMatch,
    mockPermission,
    version: manifest.version,
    contentScriptMatches: (manifest.content_scripts || []).map(script => script.matches || []),
    hostPermissions: manifest.host_permissions || []
}, null, 2))
