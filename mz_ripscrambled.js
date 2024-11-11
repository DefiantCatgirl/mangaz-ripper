const fs = require('fs').promises;
const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const sanitize = require('sanitize-filename');
const { JSDOM } = require('jsdom');
const { Queue } = require('async-await-queue');
const path = require('path');

// This script _only_ accepts series IDs

// It's made for batch ripping specifically, and it tries to make sure 
// there is always a unique directory for everything, even when metadata is largely borked.

axiosRetry(axios, {
    retries: 5,
    retryDelay: (retryCount) => {
        console.log(`retry attempt: ${retryCount}`);
        return retryCount * 1000;
    },
    retryCondition: (error) => {
        // only retry if there is a network error or internal server error (usually happens when it's overloaded)
        // don't retry on "bad request" or "not found" since there is no point
        if (!error.response || !error.response.status) {
            return true;
        }
        return error.response.status >= 500;
    },
});

// Parse input arguments
const argv = require('minimist')(process.argv.slice(2));
if (!argv['_'] || !argv['_'][0]) {
    console.log('Series ID or URL required. E.g.:')
    console.log('node mzrip.js 163491 --threads=10 --out=Downloads');
    return;
}

const threads = argv['threads'] || 10;
const minDelayMs = argv['minDelayMs'] || 50;
const outDir = argv['out'] || __dirname;
const includeR18 = argv['includeR18'];
// Use pre-downloaded and pre-parsed book settings to speed things up a bit.
// The script will still try to download book settings if they are missing from the cache.
const bookSettingsDir = argv['bookSettingsCache'];

let seriesId = argv['_'][0].toString();

// Accept series ID directly, or get it from the series URL
// (just gets the number after the last slash, stripping away other junk)
if (seriesId.includes("/")) {
    const array = seriesId.split('/');
    seriesId = [array[array.length - 1].replace(/\D+$/g, '')]
}

const queue = new Queue(threads, minDelayMs);

// Get all book IDs belonging to this series ID, 
// following redirects to the book details page for series that only consist of one book.
async function getBookIdsOfSeries(seriesId, redirectsLeft) {
    return await getBookIdsOfSeriesByUrl(`https://www.mangaz.com/series/detail/${seriesId}`, redirectsLeft);
}

async function getBookIdsOfSeriesByUrl(url, redirectsLeft) {
    var response;
    try {
        response = await axios.get(url, {
            maxRedirects: 0,
            headers: {
                'Cookie': 'MANGAZ[age]=Q2FrZQ%3D%3D.To0%3D' // should let us through the "are you 18+" redirect
            }
         });
    } catch (error) {
        if (error.response && error.response.status === 302) {
            const redirectUrl = error.response.headers.location;
            // console.log(redirectUrl);
            if (redirectUrl.includes('/book/')) {
                const array = redirectUrl.split('/');
                return [array[array.length - 1].replace(/\D+$/g, '')];
            } else {
                if (redirectsLeft > 0) {
                    console.log("Redirects left: " + redirectsLeft);
                    return await getBookIdsOfSeriesByUrl(redirectUrl, redirectsLeft - 1);
                }
                console.log("Max redirects reached, something is wrong with this ID or URL, last URL: " + redirectUrl);
                throw {};
            }
        } else {
            throw error;
        }
    }
    const html = response.data;
    const dom = new JSDOM(html);
    const buttons = Array.from(dom.window.document.querySelectorAll('.series_sort > button')).reverse();
    return buttons.map(it => it.getAttribute('data-url').match(/navi\/(\d+)\//)[1]);
}

// For any book, importantly now including those that are not part of an _actual_ series,
// the directory name is "SeriesTitle [s123456]/01 - VolumeTitle [b123456]".

// VolumeTitle will be omitted if missing or if it's not a real series,
// s123456 is the series ID, and b123456 is the volume ID.

// Even though this complicates directory structure for non-series books, 
// it makes sure we NEVER have directories with overlapping or missing names.
function getDirectoryName(bookSettings, seriesId, volumeId, volumeNumber, totalVolumes) {
    const pad = totalVolumes.toString().length;

    const title = bookSettings.Book.title;
    const seriesDir = `${title} [s${seriesId}]`;
    const volume = bookSettings.Book.volume;
    const volumeDir = `${volumeNumber.toString().padStart(pad, "0")} ${volume ? '- ' + volume + ' ' : '' }[b${volumeId}]`;

    return path.resolve(outDir, bookSettings.Book.r18 ? 'R18' : 'WWW', sanitize(seriesDir), sanitize(volumeDir));
}


function getDownloadAndProcessImagesPromises(settings, dirName, id, volumeNumber, totalVolumes) {
    const volumePad = totalVolumes.toString().length;

    const { Location, verkey, Orders } = settings;
    const totalCount = Orders.length;
    
    let currentPage = 1;
    const pad = totalCount.toString().length;

    const logPrefix = `Book ${id}: Volume ${volumeNumber.toString().padStart(volumePad)}/${totalVolumes}: `;

    const q = [];
    for (let order of Orders) {
        const url = `${Location.base}${Location.scramble_dir}/${order.name}?${verkey}`;
        const filename = path.resolve(dirName, 'scrambled', order.name);
        let me;
        q.push(
            fileExists(filename)
                .then((exists) => {
                    if (exists) {
                        console.log(`${logPrefix}${currentPage.toString().padStart(pad)}/${totalCount} - ${order.name} exists, skipped`);
                        currentPage++;
                    } else {
                        me = Symbol();
                        return queue.wait(me, -1)
                            .then(() => axios.get(url, { responseType: 'arraybuffer' }))
                            .then((response) => fs.writeFile(filename, response.data))
                            .then(() => {
                                console.log(`${logPrefix}${currentPage.toString().padStart(pad)}/${totalCount} downloaded`);
                                currentPage++;
                            })
                    }
                })
                .catch((e) => {
                    // console.error(e);
                    console.log(`${logPrefix}failed to download image ${order.name} for page ${order.no + 1}`);
                    currentPage++;
                })
                .finally(() => me ? queue.end(me) : null)
        );
    }
    return q;
}

async function getOrDownloadBookSettings(bookId) {
    if (bookSettingsDir) {
        try {
            const bookSettings = await fs.readFile(path.resolve(bookSettingsDir, `${bookId}.metadata.json`))
            const json = JSON.parse(bookSettings);
            console.log(`Book ${bookId}: using cached metadata (${json.Book.title}${json.Book.volume ? ' - ' + json.Book.volume : ''})`);
            return json;
        } catch (e) {
            console.log(`Book ${bookId}: cached metadata missing`);
        }
    }
    
    const me = Symbol();
    return queue.wait(me, -1)
        .then(() => downloadBookSettings(bookId))
        .then((response) => {
            const json = JSON.parse(response);
            console.log(`Book ${bookId}: downloaded metadata (${json.Book.title}${json.Book.volume ? ' - ' + json.Book.volume : ''})`);
            return json;
        })
        .catch((e) => {
            console.log(`Book ${bookId}: failed to download metadata`);
            return false;
        })
        .finally(() => queue.end(me))
}

async function downloadBookSettings(bookId) {
    const url = `https://vw.mangaz.com/virgo/view/${bookId}/`;
    const response = await axios.get(url);
    const html = response.data;
    const base64 = html.match(/\<span id="doc"\>(.*?)\<\/span\>/)[1];

    if (!base64) {
        console.error(`Book ${bookId}: metadata base64 code in <span id="doc"> not found`);
        return;
    }

    return Buffer.from(base64, 'base64').toString('utf-8');
}

async function fileExists(filePath) {
    return fs.access(filePath).then(() => true, () => false)
}

function getFileDownloadPromise(id, url, filename, type) {
    let me;
    return fileExists(filename)
        .then((exists) => {
            if (exists) {
                console.log(`Book ${id}: ${type} already downloaded, skipping`);
            } else {
                me = Symbol();
                return queue.wait(me, -1)
                    .then(() => axios.get(url, { responseType: 'arraybuffer' }))
                    .then((response) => fs.writeFile(filename, response.data))
                    .then(() => {
                        console.log(`Book ${id}: downloaded ${type}`);
                    })
            }
        })
        .catch((e) => {
            console.error(e);
            console.log(`Book ${id}: failed to download ${type}`);
        })
        .finally(() => me ? queue.end(me) : null)
}

async function run() {
    console.log(`Series ${seriesId}: downloading...`)
    var ids = await getBookIdsOfSeries(seriesId, 10);

    var settingsList = await Promise.all(ids.map(id => getOrDownloadBookSettings(id)));

    // if (settingsList.some(it => !it)) {
    //     console.log(`Series ${seriesId}: failed to retrieve some of the settings, quitting`);
    //     return;
    // }

    if (ids.length === 0 || settingsList == 0) {
        console.log(`Series ${seriesId}: nothing to download!`);
        return;
    }

    console.log(`Series ${seriesId}: ${ids.length} books to download`);

    var tasks = []

    for (let i = 0; i < ids.length; i++) {
        const bookSettings = settingsList[i];
        const bookId = ids[i];

        if (!bookSettings) {
            console.error(`Book ${bookId}: Failed to retrieve settings, skipping (IMPORTANT!)`);
            continue;
        }

        if (bookSettings.Book.r18 && !includeR18) {
            console.log(`Book ${bookId}: R18, but --includeR18 was not set, skipping download`);
            continue;
        }

        const dirName = getDirectoryName(bookSettings, seriesId, bookId, i + 1, ids.length);
        await fs.mkdir(path.resolve(dirName, 'metadata'), { recursive: true });
        await fs.mkdir(path.resolve(dirName, 'scrambled'), { recursive: true });
        await fs.writeFile(
            path.resolve(dirName, 'metadata', 'metadata.json'),
            JSON.stringify(bookSettings, null, 2),
            'utf-8'
        );
        tasks.push(...getDownloadAndProcessImagesPromises(bookSettings, dirName, bookId, i + 1, ids.length))

        tasks.push(getFileDownloadPromise(bookId, `https://www.mangaz.com/book/detail/${bookId}`, 
            path.resolve(dirName, 'metadata', 'info.html'), 'info'));
        tasks.push(getFileDownloadPromise(bookId, `https://www.mangaz.com/comments?baid=${bookId}`, 
            path.resolve(dirName, 'metadata', 'comments.html'), 'comments'));

        let coverUrl = bookSettings.Book.cover_image;
        if (coverUrl) {
            let parts = coverUrl.split(".");
            tasks.push(getFileDownloadPromise(bookId, coverUrl, 
                path.resolve(dirName, 'metadata', `cover.${parts[parts.length - 1]}`), 'cover'));
        }
    }

    await Promise.all(tasks);

    console.log(`Series ${seriesId}: Finished downloading (${settingsList[0] ? settingsList[0].Book.title : 'no title'})`);
}

run();