#!/usr/bin/env node

const fs = require('fs')

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

function isProfileSearchTarget(target, needle) {
    if(target.type !== 'page') return false

    const url = target.url || ''
    let matchesProfileSearch = false
    try {
        const parsed = new URL(url)
        matchesProfileSearch = /^www[.]quora[.]com$/i.test(parsed.hostname) &&
            parsed.pathname === '/search' &&
            (parsed.searchParams.get('type') || '').toLowerCase() === 'profile'
    }
    catch {
        matchesProfileSearch = false
    }
    if(!matchesProfileSearch) return false

    if(!needle) return true
    return [url, target.title || ''].join('\n').toLowerCase().includes(needle)
}

function parseLimit() {
    const raw = getOption('limit', '')
    if(!raw) return 0

    const limit = Number.parseInt(raw, 10)
    if(!Number.isFinite(limit) || limit <= 0) throw new Error(`invalid --limit: ${raw}`)
    return limit
}

function normalizeProfileUrl(value) {
    const raw = String(value || '').trim()
    if(!raw) return ''

    const candidate = /^https?:\/\//i.test(raw)
        ? raw
        : /^(www[.])?quora[.]com\//i.test(raw)
            ? 'https://' + raw
            : ''
    if(!candidate) return ''

    try {
        const parsed = new URL(candidate)
        if(!/^https?:$/i.test(parsed.protocol)) return ''
        if(!/^(www[.])?quora[.]com$/i.test(parsed.hostname)) return ''
        const match = parsed.pathname.match(/^\/profile\/([^/?#]+)\/?$/i)
        if(!match) return ''
        return 'https://www.quora.com/profile/' + match[1]
    }
    catch {
        return ''
    }
}

function dedupeCandidates(candidates, limit) {
    const selected = []
    const indexByUrl = new Map()

    for(const candidate of Array.isArray(candidates) ? candidates : []) {
        const profileUrl = normalizeProfileUrl(candidate.profileUrl || candidate.url || '')
        if(!profileUrl) continue

        const existingIndex = indexByUrl.get(profileUrl)
        if(existingIndex !== undefined) {
            const existing = selected[existingIndex]
            existing.hasVisibleFollowButton = Boolean(existing.hasVisibleFollowButton || candidate.hasVisibleFollowButton)
            if(!existing.rowText && candidate.rowText) existing.rowText = candidate.rowText
            continue
        }

        if(limit && selected.length >= limit) continue
        indexByUrl.set(profileUrl, selected.length)
        selected.push({
            profileUrl,
            rowText: String(candidate.rowText || '').trim(),
            hasVisibleFollowButton: Boolean(candidate.hasVisibleFollowButton)
        })
    }

    return selected
}

function sanitizeComment(value) {
    return String(value || '')
        .replace(/\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function formatUrlsOut(result) {
    const lines = [
        '# Quora profile-search candidates',
        '# pageUrl: ' + sanitizeComment(result.source.pageUrl),
        '# title: ' + sanitizeComment(result.source.title),
        '# searchQuery: ' + sanitizeComment(result.source.searchQuery),
        '# count: ' + result.candidates.length
    ]

    result.candidates.forEach((candidate, index) => {
        const rowText = sanitizeComment(candidate.rowText)
        if(rowText) lines.push(`# row ${index + 1}: ${rowText}`)
        lines.push(candidate.profileUrl)
    })

    return lines.join('\n') + '\n'
}

runMain(async () => {
    const config = getCdpConfig()
    const needle = getOption('needle', '').toLowerCase()
    const limit = parseLimit()
    const outPath = getOption('out', '')
    const urlsOutPath = getOption('urls-out', '')

    const targets = await getTargets(config)
    const target = targets.find(candidate => isProfileSearchTarget(candidate, needle))
    if(!target) {
        const result = {ok: false, reason: 'profile-search-target-not-found', needle}
        if(outPath) fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n')
        else console.log(JSON.stringify(result, null, 2))
        process.exitCode = 1
        return
    }

    const visible = await evaluate(target.webSocketDebuggerUrl, `(${function collectProfileSearchCandidates() {
        const normalizeProfileHref = href => {
            try {
                const parsed = new URL(href, location.href)
                if(!/^(www\.)?quora\.com$/i.test(parsed.hostname)) return ''
                const match = parsed.pathname.match(/^\/profile\/([^/?#]+)\/?$/i)
                if(!match) return ''
                return `https://www.quora.com/profile/${match[1]}`
            }
            catch {
                return ''
            }
        }

        const compactText = value => String(value || '')
            .replace(/\s+/g, ' ')
            .trim()

        const isVisible = element => {
            if(!element || typeof element.getBoundingClientRect !== 'function') return false
            const style = getComputedStyle(element)
            if(style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
            const rect = element.getBoundingClientRect()
            if(rect.width <= 0 || rect.height <= 0) return false
            if(rect.bottom < 0 || rect.right < 0) return false
            if(rect.top > window.innerHeight || rect.left > window.innerWidth) return false
            return true
        }

        const findRow = link => {
            let best = link
            let node = link
            for(let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
                if(node === document.body || node === document.documentElement) break
                if(!isVisible(node)) continue
                const text = compactText(node.innerText || node.textContent || '')
                if(text.length >= 20 || node.matches('[role="listitem"], [data-testid], article')) best = node
                if(node.matches('[role="listitem"], article')) break
            }
            return best
        }

        const hasVisibleFollowButton = row => Array.from(row.querySelectorAll('button, [role="button"]')).some(button => {
            if(!isVisible(button)) return false
            return /^Follow$/i.test(compactText(button.innerText || button.textContent || button.getAttribute('aria-label') || ''))
        })

        const candidates = []
        for(const link of Array.from(document.querySelectorAll('a[href*="/profile/"]'))) {
            if(!isVisible(link)) continue
            const profileUrl = normalizeProfileHref(link.href || link.getAttribute('href') || '')
            if(!profileUrl) continue
            const row = findRow(link)
            candidates.push({
                profileUrl,
                rowText: compactText(row.innerText || row.textContent || '').slice(0, 500),
                hasVisibleFollowButton: hasVisibleFollowButton(row)
            })
        }

        return {
            pageUrl: location.href,
            title: document.title || '',
            searchQuery: new URLSearchParams(location.search).get('q') || '',
            candidates
        }
    }})()`, 15000)

    const source = {
        pageUrl: visible?.pageUrl || target.url || '',
        title: visible?.title || target.title || '',
        searchQuery: visible?.searchQuery || ''
    }
    const candidates = dedupeCandidates(visible?.candidates || [], limit).map(candidate => ({
        ...candidate,
        source
    }))
    const result = {
        ok: true,
        target: {id: target.id, title: target.title || '', url: target.url || ''},
        source,
        limit: limit || null,
        count: candidates.length,
        candidates
    }

    if(outPath) fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n')
    else console.log(JSON.stringify(result, null, 2))

    if(urlsOutPath) fs.writeFileSync(urlsOutPath, formatUrlsOut(result))
})
