#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

function usage(exitCode = 1) {
    const out = exitCode === 0 ? console.log : console.error
    out([
        'Usage:',
        '  text-replace.js --file path --old literal --new literal [--count 1]',
        '  text-replace.js --file path --old-file old.txt --new-file new.txt [--count 1]',
        '',
        'Options:',
        '  --root path       Safety root for --file. Defaults to the current directory.',
        '  --allow-outside  Allow --file outside the safety root.',
        '',
        'Notes:',
        '  - Resolves symlinks for --file, --root, --old-file, and --new-file.',
        '  - Refuses --file outside the resolved safety root unless --allow-outside is set.',
        '  - Template files passed with --old-file/--new-file may be outside the safety root.',
        '  - Fails if --old does not match.',
        '  - Defaults to replacing one occurrence.',
        '  - Use --count all only when the replacement is intentionally global.'
    ].join('\n'))
    process.exit(exitCode)
}

function readArg(args, name) {
    const prefix = `${name}=`
    const inline = args.find(arg => arg.startsWith(prefix))
    if(inline) return inline.slice(prefix.length)
    const index = args.indexOf(name)
    if(index >= 0) return args[index + 1] || ''
    return ''
}

function hasArg(args, name) {
    return args.includes(name) || args.some(arg => arg.startsWith(`${name}=`))
}

function realPathForExisting(inputPath, label) {
    const resolved = path.resolve(process.cwd(), inputPath)
    try {
        return fs.realpathSync(resolved)
    }
    catch(err) {
        throw new Error(`cannot resolve ${label} ${inputPath}: ${err.message}`)
    }
}

function resolveTargetPath(inputPath, rootPath, allowOutside) {
    const resolvedRoot = realPathForExisting(rootPath, '--root')
    const resolvedTarget = realPathForExisting(inputPath, '--file')

    if(!allowOutside) {
        const relative = path.relative(resolvedRoot, resolvedTarget)
        if(relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error(
                `refusing path outside root: ${inputPath} ` +
                `(resolved ${resolvedTarget}, root ${resolvedRoot})`
            )
        }
    }

    return {filePath: resolvedTarget, rootPath: resolvedRoot}
}

function main() {
    const args = process.argv.slice(2)
    if(args.includes('--help') || args.includes('-h')) usage(0)

    const fileArg = readArg(args, '--file')
    if(!fileArg) usage(1)

    const rootArg = readArg(args, '--root') || process.cwd()
    const allowOutside = hasArg(args, '--allow-outside')

    const oldValue = hasArg(args, '--old-file')
        ? fs.readFileSync(realPathForExisting(readArg(args, '--old-file'), '--old-file'), 'utf8')
        : readArg(args, '--old')
    const newValue = hasArg(args, '--new-file')
        ? fs.readFileSync(realPathForExisting(readArg(args, '--new-file'), '--new-file'), 'utf8')
        : readArg(args, '--new')
    const countArg = readArg(args, '--count') || '1'

    if(!oldValue) throw new Error('missing --old or empty old value')
    if(!hasArg(args, '--new') && !hasArg(args, '--new-file')) throw new Error('missing --new or --new-file')

    const {filePath, rootPath} = resolveTargetPath(fileArg, rootArg, allowOutside)
    const before = fs.readFileSync(filePath, 'utf8')
    const occurrences = before.split(oldValue).length - 1
    if(occurrences <= 0) throw new Error(`old value not found in ${fileArg}`)

    let after = ''
    let replacements = 0
    if(countArg === 'all') {
        after = before.split(oldValue).join(newValue)
        replacements = occurrences
    }
    else {
        const count = Number.parseInt(countArg, 10)
        if(!Number.isFinite(count) || count <= 0) throw new Error(`invalid --count: ${countArg}`)
        let remaining = count
        let cursor = 0
        const chunks = []
        while(remaining > 0) {
            const index = before.indexOf(oldValue, cursor)
            if(index < 0) break
            chunks.push(before.slice(cursor, index), newValue)
            cursor = index + oldValue.length
            remaining -= 1
            replacements += 1
        }
        chunks.push(before.slice(cursor))
        after = chunks.join('')
    }

    if(replacements <= 0) throw new Error(`old value not replaced in ${fileArg}`)
    fs.writeFileSync(filePath, after)
    console.log(JSON.stringify({
        ok: true,
        file: fileArg,
        resolved_file: filePath,
        root: rootPath,
        allow_outside: allowOutside,
        occurrences,
        replacements
    }))
}

main()
