#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const {execFileSync} = require('child_process')

const repoRoot = path.resolve(__dirname, '..')
const sourceDir = path.join(repoRoot, 'chrome')
const targetDir = path.join(repoRoot, 'chrome-dev')
const manifestPath = path.join(targetDir, 'manifest.json')
const buildInfoPath = path.join(targetDir, 'build-info.json')
const MAX_EXTENSION_NAME_LENGTH = 75

function git(args) {
    try {
        return execFileSync('git', args, {cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim()
    }
    catch {
        return ''
    }
}

// Which branch and commit this dev copy came from, so two dev loads with the same version number can be told apart.
function readBuildIdentity() {
    const rawBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
    const branch = rawBranch && rawBranch !== 'HEAD' ? rawBranch.replace(/[^A-Za-z0-9._/-]/g, '-') : 'detached'
    return {
        branch: branch || 'unknown',
        commit: git(['rev-parse', '--short', 'HEAD']) || 'unknown',
        dirty: git(['status', '--porcelain']).length > 0
    }
}

function copyDirectory(source, target) {
    fs.rmSync(target, {recursive: true, force: true})
    fs.mkdirSync(target, {recursive: true})
    fs.cpSync(source, target, {
        recursive: true,
        filter: pathname => path.extname(pathname) !== '.zip'
    })
}

if(!fs.existsSync(path.join(sourceDir, 'manifest.json'))) {
    throw new Error('chrome build output is missing; run npm run prod first')
}

copyDirectory(sourceDir, targetDir)

const identity = readBuildIdentity()
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
delete manifest.key
const baseName = `${manifest.name || 'Mute Block'} Dev`
const suffix = ` (${identity.branch}${identity.dirty ? ', dirty' : ''})`
manifest.name = `${baseName}${suffix}`.slice(0, MAX_EXTENSION_NAME_LENGTH)
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

const buildInfo = {
    version: manifest.version || '',
    branch: identity.branch,
    commit: identity.commit,
    dirty: identity.dirty,
    builtAt: new Date().toISOString()
}
fs.writeFileSync(buildInfoPath, `${JSON.stringify(buildInfo, null, 2)}\n`)

console.log(JSON.stringify({
    ok: true,
    sourceDir,
    targetDir,
    version: buildInfo.version,
    keyStripped: !Object.prototype.hasOwnProperty.call(manifest, 'key'),
    name: manifest.name || '',
    branch: buildInfo.branch,
    commit: buildInfo.commit,
    dirty: buildInfo.dirty
}, null, 2))
