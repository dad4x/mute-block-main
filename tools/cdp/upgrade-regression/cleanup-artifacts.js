#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function usage() {
  console.log(`Usage: node tools/cdp/upgrade-regression/cleanup-artifacts.js [options]

Removes old files from tmp/upgrade-regression while keeping the newest artifacts.

Options:
  --dir <path>         Artifact directory. Default: tmp/upgrade-regression
  --keep <count>       Number of newest files to keep. Default: 10
  --delete             Actually delete old files. Without this, only prints a dry run.
  --include <pattern>  Only consider files whose basename includes pattern.
  --help              Show this help.
`);
}

function parseArgs(argv) {
  const options = {
    dir: path.join('tmp', 'upgrade-regression'),
    keep: 10,
    delete: false,
    include: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--delete') {
      options.delete = true;
    } else if (arg === '--dir') {
      i += 1;
      if (!argv[i]) {
        throw new Error('--dir requires a path');
      }
      options.dir = argv[i];
    } else if (arg === '--keep') {
      i += 1;
      if (!argv[i]) {
        throw new Error('--keep requires a count');
      }
      options.keep = Number(argv[i]);
      if (!Number.isInteger(options.keep) || options.keep < 0) {
        throw new Error('--keep must be a non-negative integer');
      }
    } else if (arg === '--include') {
      i += 1;
      if (!argv[i]) {
        throw new Error('--include requires a pattern');
      }
      options.include = argv[i];
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }

  return options;
}

function formatBytes(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const dir = path.resolve(options.dir);
  if (!fs.existsSync(dir)) {
    console.log(`Artifact directory does not exist: ${dir}`);
    return;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => !options.include || entry.name.includes(options.include))
    .map((entry) => {
      const filePath = path.join(dir, entry.name);
      const stat = fs.statSync(filePath);
      return {
        name: entry.name,
        path: filePath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));

  const keep = entries.slice(0, options.keep);
  const remove = entries.slice(options.keep);
  const removeBytes = remove.reduce((sum, entry) => sum + entry.size, 0);

  console.log(`${options.delete ? 'Deleting' : 'Dry run: would delete'} ${remove.length} of ${entries.length} files from ${dir}`);
  console.log(`Keeping newest ${keep.length}; reclaimable: ${formatBytes(removeBytes)}`);

  if (keep.length > 0) {
    console.log('\nKept newest files:');
    for (const entry of keep) {
      console.log(`  keep   ${formatBytes(entry.size).padStart(9)}  ${entry.name}`);
    }
  }

  if (remove.length > 0) {
    console.log('\nOld files:');
    for (const entry of remove) {
      console.log(`  ${options.delete ? 'delete' : 'would'} ${formatBytes(entry.size).padStart(9)}  ${entry.name}`);
      if (options.delete) {
        fs.rmSync(entry.path);
      }
    }
  }
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : String(err));
  process.exitCode = 1;
}
