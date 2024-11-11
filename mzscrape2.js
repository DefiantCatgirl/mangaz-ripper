const fs = require('fs').promises;
const axios = require('axios');
const path = require('path');
const { Queue } = require('async-await-queue');

const axiosRetry = require('axios-retry').default;

axiosRetry(axios, {
    retries: 5, // number of retries
    retryDelay: (retryCount) => {
        console.log(`retry attempt: ${retryCount}`);
        return retryCount * 1000; // time interval between retries
    },
    retryCondition: (error) => {
        if (!error.response || !error.response.status) {
            return true;
        }
        return error.response.status >= 500;
    },
});


const argv = require('minimist')(process.argv.slice(2));

const threads = argv['threads'] || 10;
const fromArg = argv['from'] || 0;
const toArg = argv['to'] || 300000;
const outDir = argv['out'] || __dirname;


const totalCount = toArg - fromArg + 1;
let logI = 1;
let logTo = totalCount;

const pad = totalCount.toString().length;
const logIPad = logTo.toString().length;

const queue = new Queue(threads, 50);

async function runSegment(from, to) {
    const q = [];
    for (let i = from; i <= to; i++) {
        const j = i;
        const me = Symbol();
        q.push(
            queue
                .wait(me, -1)
                .then(() => axios.get(`https://vw.mangaz.com/virgo/view/${j}/`))
                .then((response) => fs.writeFile(path.resolve(outDir, `${j}.virgo.html`), response.data, 'utf-8'))
                .then(() => {
                    console.log(`${logI.toString().padStart(logIPad)}/${logTo}: id ${j.toString().padStart(pad)} FOUND`)
                    logI++;
                })
                .catch((e) => {
                    // console.error(e);
                    console.log(`${logI.toString().padStart(logIPad)}/${logTo}: id ${j.toString().padStart(pad)} not found`)
                    logI++;
                })
                .finally(() => queue.end(me))
        );
    }
    return Promise.all(q);
}

async function run() {
    await fs.mkdir(outDir, { recursive: true });

    const segmentSize = 1000;
    const totalCount = toArg - fromArg + 1;
    let segmentCount = (totalCount / segmentSize) | 0;
    if ((totalCount % segmentSize) != 0) {
        segmentCount++;
    }

    for(let i = 0; i < segmentCount; i++) {
        const from = fromArg + (i * segmentSize);
        const to = Math.min(from + segmentSize - 1, toArg);
        console.log(`Segment ${i + 1}: ${from}-${to}`);
        await runSegment(from, to);
    }

    console.log("Scrape complete.");
}

run();