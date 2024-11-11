const fs = require('fs');
const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const sanitize = require('sanitize-filename');
const { JSDOM } = require('jsdom');
const Piscina = require('piscina');
const path = require('path');

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
if (!argv['_'] || !argv['_'][0]) {
    console.log('ID required. E.g.:')
    console.log('node mzrip.js 163491 --threads=10 --out=Downloads');
    return;
}

const threads = argv['threads'] || 10;
const outDir = argv['out'] || __dirname;

let idArgument = argv['_'][0].toString();

let seriesId = '';

const pool = new Piscina({
    filename: path.resolve(__dirname, 'mzworker.mjs'),
    maxThreads: threads,
    // minThreads: threads,
});

async function getIdsFromArgument(idArgument) {
    if (idArgument.includes("/series/")) {
        const array = idArgument.split('/');
        seriesId = [array[array.length - 1].replace(/\D+$/g, '')]
        return await getBookIdsOfSeries(idArgument, 10)
    }
    else if (idArgument.indexOf('/') >= 0) {
        const array = idArgument.split('/');
        return [array[array.length - 1].replace(/\D+$/g, '')];
    }
    return [idArgument];
}

async function getBookIdsOfSeries(seriesUrl, redirectsLeft) {
    var response;
    try {
        response = await axios.get(seriesUrl, {
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
                    return await getBookIdsOfSeries(redirectUrl, redirectsLeft - 1);
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


function getDirectoryName(bookSettings, definitelySeries, volumeNumber) {

    const seriesWithDupeNames = ['43381','45561','114971','118471','146691','148831','148841','162031','162861','162891','162951','163401',
        '163431','163441','163451','163461','165011','165021','165031','165041','186201','186211','186351','187871','195041','213501','213811','220941'];

    let title = bookSettings.Book.title;
    if (seriesWithDupeNames.indexOf(seriesId) >= 0) {
        // ugly hack, but too lazy to redo everything
        title += ` [${seriesId}]`;
    }
    const volume = bookSettings.Book.volume;
    
    let directoryName = path.resolve(outDir, 'Downloads', sanitize(title));
    if (volume) {
        directoryName = path.resolve(directoryName, sanitize(volume));
    } else if (definitelySeries) {
        directoryName = path.resolve(directoryName, volumeNumber + " [" + bookSettings.Book.baid.toString() + "]");
    } else if (bookSettings.Book.baid !== bookSettings.Book.series_id) {
        directoryName = path.resolve(directoryName, volumeNumber + " [" + bookSettings.Book.baid.toString() + "]");
    }
    return directoryName;
}

async function downloadAndProcessImages(settings, dirName, id) {
    const { Location, verkey, Orders } = settings;
    const totalCount = Orders.length;
    
    let currentPage = 1;
    const pad = totalCount.toString().length;

    let tasks = [];
    // Enqueue download tasks
    for (let order of Orders) {
        const url = `${Location.base}${Location.scramble_dir}/${order.name}?${verkey}`;

        // Push task to pool and await completion
        tasks.push(pool.run({ url, order, dirName, totalCount, params: { oxipng: argv['oxipng'], sharp: argv['sharp'] } }, { name: 'processImage' }).then((skipped) => {
            if (skipped) {
                console.log("File exists, skipping");
            }
            console.log(`Processed page ${currentPage.toString().padStart(pad)}/${totalCount}`);
            currentPage++;
        }));
    }

    if (settings.Book && settings.Book.cover_image) {
        tasks.push(pool.run({ url: settings.Book.cover_image, dirName }, { name: 'saveCoverImage' }).then((skipped) => {
            if (skipped) {
                console.log("Cover exists, skipping");
            } else {
                console.log(`Downloaded cover`);
            }
        }));
    }

    tasks.push(pool.run({ id, dirName }, { name: 'getBookPageInfo' }).then((skipped) => {
        if (skipped) {
            console.log("Book information exists, skipping");
        } else {
            console.log(`Downloaded book information page`);
        }
    }).catch((e) => {
        console.log(e);
        console.log("Error downloading book information page");
    }))

    tasks.push(pool.run({ id, dirName }, { name: 'getCommentsPage' }).then((skipped) => {
        if (skipped) {
            console.log("Comments exist, skipping");
        } else {
            console.log(`Downloaded comments`);
        }
    }).catch((e) => {
        console.log(e);
        console.log("Error downloading comments");
    }))

    await Promise.all(tasks);

    console.log("All images processed.");
}

async function processId(id, idLength, volumeNumber) {
    // Run the function with the provided ID
    let bookSettings;
    try {
        console.log(`Fetching settings for book ID ${id}`);
        bookSettings = await pool.run({id, mode: 'virgo'}, { name: 'getBookSettings' });
    } catch (error) {
        console.error('Error fetching or processing data:', error);
        return;
    }

    console.log(`Downloading ${bookSettings.Book.title}` + (bookSettings.Book.volume ? `, volume ${bookSettings.Book.volume}` : ''));

    const dirName = getDirectoryName(bookSettings, idLength > 1, volumeNumber);
    fs.mkdirSync(dirName, { recursive: true });
    fs.writeFileSync(
        `${dirName}/metadata.json`,
        JSON.stringify(bookSettings, null, 2),
        'utf-8'
    );

    // await downloadAndProcessImages(bookSettings, dirName)
    downloadAndProcessImages(bookSettings, dirName, id)
}

async function run() {
    var ids = await getIdsFromArgument(idArgument);
    let i = 1;
    console.log(`${ids.length} books to download`);
    for (const id of ids) {
        await processId(id, ids.length, i);
        i++;
    }
}

run();
