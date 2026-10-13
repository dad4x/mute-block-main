#!/usr/bin/env node

const {ESLint} = require('eslint')

const args = new Set(process.argv.slice(2))
const reviewOnly = args.has('--review')

const targetPatterns = [
    'shared/**/*.js',
    'test/**/*.js',
    'tools/**/*.js'
]

const correctnessRules = {
    'getter-return': 'error',
    'no-constant-condition': ['error', {checkLoops: false}],
    'no-dupe-args': 'error',
    'no-dupe-keys': 'error',
    'no-duplicate-case': 'error',
    'no-invalid-regexp': 'error',
    'no-setter-return': 'error',
    'no-undef': 'error',
    'no-unreachable': 'error',
    'no-unsafe-optional-chaining': 'error',
    'valid-typeof': 'error'
}

const reviewRules = reviewOnly ? {
    'no-empty': ['warn', {allowEmptyCatch: false}],
    'no-unused-vars': ['warn', {
        args: 'none',
        caughtErrors: 'none',
        ignoreRestSiblings: true,
        varsIgnorePattern: '^_'
    }],
    'no-use-before-define': ['warn', {
        functions: false,
        classes: true,
        variables: true,
        allowNamedExports: false
    }],
    'require-atomic-updates': 'warn'
} : {}

async function main() {
    const eslint = new ESLint({
        useEslintrc: false,
        ignore: true,
        overrideConfig: {
            env: {
                browser: true,
                es2022: true,
                node: true,
                webextensions: true
            },
            parserOptions: {
                ecmaVersion: 2022,
                sourceType: 'script'
            },
            globals: {
                BigInt64Array: 'readonly',
                BigUint64Array: 'readonly',
                URLPattern: 'readonly',
                chrome: 'readonly',
                browser: 'readonly'
            },
            rules: {
                ...correctnessRules,
                ...reviewRules
            },
            overrides: [
                {
                    files: ['tools/cdp/**/*.js'],
                    globals: {
                        activeQueuedTabs: 'readonly',
                        CDP_HOST: 'readonly',
                        CDP_PORT: 'readonly',
                        coordinatorAuthority: 'readonly',
                        coordinatorExecutorStartPromise: 'readonly',
                        coordinatorQueueResumeAllowBeforeQuora: 'readonly',
                        coordinatorQueueResumeDueAt: 'readonly',
                        coordinatorQueueResumeReason: 'readonly',
                        coordinatorQueueResumeTimeout: 'readonly',
                        coordinatorResumePromise: 'readonly',
                        EXTENSION_ID: 'readonly',
                        getCoordinatorWhyNotRunning: 'readonly',
                        ownedTabIdsByParent: 'readonly',
                        owningParentByChild: 'readonly',
                        pausedQueuedOwners: 'readonly',
                        pendingTabActions: 'readonly',
                        queuedTabActions: 'readonly',
                        queuedTabFillPromise: 'readonly',
                        queueWakeupCounters: 'readonly',
                        quoraRuntimeActivated: 'readonly',
                        spaceFeedStorageUpdateDepth: 'readonly'
                    }
                }
            ]
        }
    })

    const results = await eslint.lintFiles(targetPatterns)
    const formatter = await eslint.loadFormatter('stylish')
    const output = formatter.format(results)
    if(output.trim()) process.stdout.write(output)

    const errorCount = results.reduce((sum, result) => sum + result.errorCount, 0)
    if(errorCount > 0) process.exitCode = 1
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
