#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const sourceDir = path.join(repoRoot, 'chrome')
const targetDir = path.join(repoRoot, 'chrome-dev')
const manifestPath = path.join(targetDir, 'manifest.json')

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

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
delete manifest.key
manifest.name = `${manifest.name || 'Mute Block'} Dev`
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

console.log(JSON.stringify({
    ok: true,
    sourceDir,
    targetDir,
    version: manifest.version || '',
    keyStripped: !Object.prototype.hasOwnProperty.call(manifest, 'key'),
    name: manifest.name || ''
}, null, 2))
