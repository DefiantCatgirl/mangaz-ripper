import fs from 'fs';
import { resolve } from 'path';
import minimist from 'minimist';
import { exit } from 'process';

// Parse input arguments
const argv = minimist(process.argv.slice(2));
if (!argv['_'] || !argv['_'][0]) {
    console.log('Series dir required. E.g.:')
    console.log('node mz_parsesettings.js scrapedSettings --out=bookSettingsCache');
    exit(1);
}

const inDir = argv['_'][0];
const outDir = argv['out'] || path.resolve(__dirname, 'bookSettingsCache');

async function run() {
    const files = fs.readdirSync(inDir)
    for (let file of files) {
        const id = file.split(".")[0];

        const html = fs.readFileSync(resolve(inDir, file), 'utf-8');

        const base64 = html.match(/\<span id="doc"\>(.*?)\<\/span\>/)[1];
        if (!base64) {
            console.error(`Book ${id}: metadata base64 code in <span id="doc"> not found`);
            continue;
        }
        // const json = JSON.parse(Buffer.from(base64, 'base64').toString('utf-8'));
        
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(resolve(outDir, `${id}.metadata.json`), Buffer.from(base64, 'base64').toString('utf-8'), 'utf-8');
    }
}

run();
