const fs = require('fs');
const path = require('path');
const spawn = require("child_process").spawn
const { stderr, stdout } = require('node:process');

async function spawnChild(...command) {
    const child = spawn(command[0], command.slice(1));

    for await (const chunk of child.stdout) {
        stdout.write("" + chunk);
    }
    let error = "";
    for await (const chunk of child.stderr) {
        stderr.write("" + chunk);
    }
    const exitCode = await new Promise((resolve, reject) => {
        child.on("close", resolve);
    });

    if (exitCode) {
        throw new Error(`subprocess error exit ${exitCode}, ${error}`);
    }
    return;
}

const argv = require('minimist')(process.argv.slice(2));
if (!argv['_'] || !argv['_'][0]) {
    console.log('File required. E.g.:')
    console.log('node mzrip_csv.js series.csv --from=1000 --to=1999 --threads=10 --out=Downloads');
    return;
}

const threads = argv['threads'] || 10;
const minDelayMs = argv['minDelayMs'] || 50;
const outDir = argv['out'] || __dirname;
const includeR18 = argv['includeR18'];
const bookSettingsDir = argv['bookSettingsCache'];

const file = argv['_'][0];
const from = argv['from'] || 1;

// Read the CSV file
fs.readFile(file, 'utf8', async (err, data) => {
  if (err) {
    console.error('Error reading file:', err);
    return;
  }

  const lines = data.trim().split('\n');

  const to = Math.min(argv['to'] || lines.length, lines.length);
  
  // Ensure "from" and "to" are within bounds
  if (from < 1 || to > lines.length || from > to) {
    console.error('Invalid range for "from" and "to" parameters.');
    process.exit(1);
  }

  // Process each line within the given range
  for (let i = from - 1; i < to; i++) {
    const line = lines[i].split(',')[0].trim();
    const parts = line.split("/");
    const id = parts[parts.length - 1];
    console.log();
    console.log(`------ Processing line ${i + 1}: series ID ${id} ------`);
    console.log();

    let args = ["node", "mz_ripscrambled.js"]
    if (includeR18) {
      args.push("--includeR18");
    }
    if (bookSettingsDir) {
      args.push("--bookSettingsCache", bookSettingsDir);
    }
    args = args.concat([`--threads=${threads}`, `--minDelayMs`, minDelayMs, `--out=${outDir}`, "--", id]);

    await spawnChild(...args);
  }

  console.log(`Batch processing of lines ${from}-${to} finished`)
});
