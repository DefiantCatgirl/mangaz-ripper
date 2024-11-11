const fs = require('fs').promises;
const sharp = require('sharp');
const path = require('path');
const { execFile } = require('child_process');
const util = require('node:util');
const process = require('process');
const { Jimp } = require('jimp');
const Piscina = require('piscina');

const execFileAsync = util.promisify(execFile);

// Parse input arguments
const argv = require('minimist')(process.argv.slice(2));
if (!argv['_'] || !argv['_'][0]) {
    console.log('Folder required. E.g.:')
    console.log('node mz_descramble.js --out=Downloads/some_series ./Downloads/some_series');
    console.log('node mz_descramble.js --from=0 --to=100 --out=Descrambled ./Downloads');
    return;
}

const inDir = argv['_'][0];
const threads = argv['threads'] || 10;
const outDir = argv['out'] || inDir;
const from = argv['from'];
const to = argv['to'];
const oxipng = argv['oxipng'];
const useSharp = argv['sharp'];

const pool = new Piscina({
    filename: path.resolve(__dirname, 'mz_descramble_worker.mjs'),
    maxThreads: threads,
    // minThreads: threads,
});

async function fileExists(filePath) {
    return fs.access(filePath).then(() => true, () => false)
}

async function processDir(dir, relativeDirs, from, to) {
    if (await fileExists(path.resolve(dir, 'metadata', 'metadata.json'))) {
        await descrambleDir(dir, relativeDirs);
    }

    const directories = (await fs.readdir(dir, { withFileTypes: true }))
        .filter(it => it.isDirectory() && it !== 'metadata' && it !== 'scrambled')

    const realFrom = from || 1;
    const realTo = Math.min(to || directories.length, directories.length);
    const total = realTo - realFrom + 1;

    const slice = directories.slice(realFrom - 1, realTo);
    
    for (let i = 0; i < slice.length; i++) {
        const nextDir = slice[i];
        if (from && to) {
            console.log(`--- Processing ${i + realFrom} of ${realFrom}-${realTo} - ${nextDir.name} ---`);
        }
        await processDir(path.resolve(dir, nextDir.name), relativeDirs.concat(nextDir.name));
    }
}

async function descrambleDir(dir, relativeDirs) {
    const dirName = path.basename(dir);
    console.log(`${dirName}: descrambling...`)

    // console.log(relativeDirs);
    const bookOutDir = path.resolve(outDir, ...relativeDirs);
    await fs.mkdir(path.resolve(bookOutDir, 'metadata'), { recursive: true });

    const metadataFile = await fs.readFile(path.resolve(dir, 'metadata', 'metadata.json'), 'utf-8');
    const metadata = JSON.parse(metadataFile);

    let currentPage = 1;
    const totalPages = metadata.Orders.length;
    const pad = totalPages.toString().length;

    const promises = metadata.Orders.map(order => 
        descrambleImage(dir, bookOutDir, order, totalPages)
            .then((skipped) => {
                if (skipped) {
                    console.log(`${dirName}: ${currentPage.toString().padStart(pad)}/${totalPages} exists, skipped`);
                } else {
                    console.log(`${dirName}: ${currentPage.toString().padStart(pad)}/${totalPages} descrambled`);
                }
                currentPage++;
            })
            .catch((e) => {
                console.log(e);
                console.log(`${dirName}: failed to descramble ${currentPage.toString().padStart(pad)}/${totalPages}`);
                currentPage++;
            })
    );

    promises.push(
        pool.run({ dir, outDir: bookOutDir }, { name: 'getBookPageInfo' }).then(skipped => {
            if (skipped) {
                console.log(`${dirName}: page info exists, skipped`);
            } else {
                console.log(`${dirName}: page info extracted`);
            }
        }),
        pool.run({ dir, outDir: bookOutDir }, { name: 'getCommentsPage' }).then(skipped => {
            if (skipped) {
                console.log(`${dirName}: comments exist, skipped`);
            } else {
                console.log(`${dirName}: comments extracted`);
            }
        }),
        pool.run({ dir, outDir: bookOutDir }, { name: 'copyCover' }).then(skipped => {
            if (skipped) {
                console.log(`${dirName}: cover exists, skipped`);
            } else {
                console.log(`${dirName}: cover copied`);
            }
        }),
        pool.run({ dir, outDir: bookOutDir }, { name: 'copyMetadata' }).then(skipped => {
            if (skipped) {
                console.log(`${dirName}: metadata exists, skipped`);
            } else {
                console.log(`${dirName}: metadata copied`);
            }
        }),
    )

    return Promise.all(promises);
}

async function descrambleImage(dir, bookOutDir, order, totalPages) {
    const scrambledFilename = path.resolve(dir, 'scrambled', order.name);

    const pad = totalPages.toString().length;
    const fileName = path.resolve(bookOutDir, `${order.no.toString().padStart(pad, "0")}.png`);
    
    if (await fileExists(fileName)) {
        return true;
    }

    if (useSharp) {
        await descrambleImageSharp(scrambledFilename, fileName, order);
    } else {
        await pool.run({ scrambledFilename, fileName, order }, { name: 'descrambleImageJimp' });
        if (oxipng) {
            await pool.run({ fileName }, { name: 'runOxipng' });
        }
    }
}

async function descrambleImageSharp(scrambledFilename, fileName, order) {
    const { w: width, h: height, crops } = order.scramble;

    const scrambledBuffer = await sharp(scrambledFilename).toBuffer();

    let compositeArray = [];

    for (const crop of crops) {
        const { x, y, x2, y2, w, h } = crop;

        const croppedImage = await sharp(scrambledBuffer)
            .extract({ left: x2, top: y2, width: w, height: h })
            .toBuffer();

        compositeArray.push({
            input: croppedImage,
            top: y,
            left: x,
        });
    }

    const resultImage = await sharp({
        create: {
            width: width,
            height: height,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 }, // White background
        },
    })
        .composite(compositeArray)
        .png()
        .toBuffer();

    if (oxipng) {
        await sharp(resultImage)
            .png({ compressionLevel: 0 })
            .toFile(fileName);
        try {
            await pool.run({ fileName }, { name: 'runOxipng' });
        } catch (error) {
            console.log(error);
        }
    } else {
        await sharp(resultImage)
            .png({ compressionLevel: 9 })
            .toFile(fileName)
    }
}

async function run() {
    console.time('time');
    console.log(`start`);

    await processDir(inDir, [], from, to);

    console.log(`done`);
    console.timeEnd('time');
}

run();