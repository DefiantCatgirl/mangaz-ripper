const fs = require('fs');
const axios = require('axios');
const sanitize = require('sanitize-filename');
const { JSDOM } = require('jsdom');
const Piscina = require('piscina');
const path = require('path');

const argv = require('minimist')(process.argv.slice(2));

const threads = argv['threads'] || 10;
const fromArg = argv['from'] || 0;
const toArg = argv['to'] || 300000;
const outDir = argv['out'] || __dirname;
const zappToken = argv['token'];
const mode = argv['mode'] || 'virgo';

const pool = new Piscina({
    filename: path.resolve(__dirname, 'mzworker.mjs'),
    maxThreads: threads,
    // minThreads: threads,
});

function getDirectoryName(bookSettings) {
    const seriesWithDupeNames = ['43381','45561','114971','118471','146691','148831','148841','162031','162861','162891','162951','163401',
        '163431','163441','163451','163461','165011','165021','165031','165041','186201','186211','186351','187871','195041','213501','213811','220941'];

    let seriesId = bookSettings.Book.series_id;
    let title = bookSettings.Book.title;
    if (seriesWithDupeNames.indexOf(seriesId) >= 0) {
        // ugly hack, but too lazy to redo everything now
        title += ` [${seriesId}]`;
    }
    const volume = bookSettings.Book.volume;
    let directoryName = path.resolve(outDir, 'Downloads', sanitize(title));
    if (volume) {
        directoryName = path.resolve(directoryName, sanitize(volume));
    } else if (bookSettings.Book.baid !== bookSettings.Book.series_id) {
        directoryName = path.resolve(directoryName, bookSettings.Book.baid.toString());
    }
    return directoryName;
}

const totalCount = toArg - fromArg + 1;
let logI = 1;
let logTo = totalCount;

const pad = totalCount.toString().length;
const logIPad = logTo.toString().length;


async function runSegment(from, to, totalCount) {
    let tasks = [];

    for (let i = from; i <= to; i++) {
        const j = i;
        let task = pool.run({id: i.toString(), mode, zappToken }, { name: 'getBookSettings' }).then((bookSettings => {
            const dirName = getDirectoryName(bookSettings);
            fs.mkdirSync(dirName, { recursive: true });
            fs.writeFileSync(
                `${dirName}/metadata.json`,
                JSON.stringify(bookSettings, null, 2),
                'utf-8'
            );
            console.log(`${logI.toString().padStart(logIPad)}/${logTo}: id ${j.toString().padStart(pad)} found: ${bookSettings.Book.title}${bookSettings.Book.volume ? " -- " + bookSettings.Book.volume : "" }`)
            logI++;
        }) ).catch( e => {
            // console.log(e);
            console.log(`${logI.toString().padStart(logIPad)}/${logTo}: id ${j.toString().padStart(pad)} not found`)
            logI++;
        });
        tasks.push(task);
    }

    await Promise.all(tasks);
}

async function run() {
    const segmentSize = 200;
    const totalCount = toArg - fromArg + 1;
    let segmentCount = (totalCount / segmentSize) | 0;
    if ((totalCount % segmentSize) != 0) {
        segmentCount++;
    }

    for(let i = 0; i < segmentCount; i++) {
        const from = fromArg + (i * segmentSize);
        const to = Math.min(from + segmentSize - 1, toArg);
        console.log(`Segment ${i + 1}: ${from}-${to}`);
        await runSegment(from, to, totalCount);
    }

    console.log("Scrape complete.");
}

run();