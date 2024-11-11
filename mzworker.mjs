import axios from 'axios';
import { Jimp } from "jimp";
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { JSDOM } from 'jsdom';
import JPEG from 'jpeg-js';
import { execFile } from 'child_process';
import util from 'node:util';
import axiosRetry from 'axios-retry';

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

const execFileAsync = util.promisify(execFile);

export async function getBookPageInfo({id, dirName}) {
    try {
        if (fs.existsSync(path.resolve(dirName, 'info.json')) && 
            fs.existsSync(path.resolve(dirName, 'info.html'))) {
            return true;
        }

        const url = "https://www.mangaz.com/book/detail/" + id
        const response = await axios.get(url);
        const html = response.data;

        const dom = new JSDOM(html);
        const info = {};
        const description = dom.window.document.querySelector(".inductionInfoSummary")
        if (description) {
            info.description = description.textContent.trim();
        }
        const tags = Array.from(dom.window.document.querySelectorAll(".inductionTags > li")).map(it => it.textContent.trim());
        info.tags = tags;
        const staffComment = dom.window.document.querySelector(".inductionInfoStaff")
        if (staffComment) {
            info.staffComment = staffComment.textContent.trim();
        }

        fs.writeFileSync(
            path.resolve(dirName, 'info.json'),
            JSON.stringify(info, null, 2),
            'utf-8'
        );

        fs.writeFileSync(
            path.resolve(dirName, 'info.html'),
            response.data,
            'utf-8'
        );
    } catch (error) {
        // console.log("Failed to load book information page");
    }
}

export async function getCommentsPage({id, dirName}) {
    try {
        if (fs.existsSync(path.resolve(dirName, 'comments.json')) &&
            fs.existsSync(path.resolve(dirName, 'comments.html'))) {
            return true;
        }

        const url = "https://www.mangaz.com/comments?baid=" + id
        const response = await axios.get(url);
        const html = response.data;

        const dom = new JSDOM(html);
        
        const comments = [];
        
        Array.from(dom.window.document.querySelectorAll(".commentListBook > li")).forEach(thread => {
            const opPost = thread.querySelector(".threadBox");

            let post = getPostFromElement(opPost);

            const replies = Array.from(thread.querySelectorAll(".replyBox > li"));
            if (replies && replies.length > 0) {
                post.replies = replies.map(it => getPostFromElement(it));
            }

            comments.push(post);
        })

        fs.writeFileSync(
            path.resolve(dirName, 'comments.json'),
            JSON.stringify({ comments }, null, 2),
            'utf-8'
        );

        fs.writeFileSync(
            path.resolve(dirName, 'comments.html'),
            response.data,
            'utf-8'
        );
    } catch (error) {
        console.log(error);
        console.log("Failed to load comments");
    }
}

function getPostFromElement(element) {
    let post = {};

    const spoiler = element.querySelector(".text > p.spoiler");
    if (spoiler) {
        post.spoiler = true;
    }

    const text = element.querySelector(".text > p:not(.spoiler)");
    if (text) {
        post.text = text.textContent.trim();
    }

    const author = element.querySelector(".author");
    if (author) {
        let authorText = author.textContent.trim();
        if (authorText.startsWith("投稿者：")) {
            authorText = authorText.slice(4);
        }
        post.author = authorText;
    }

    const zAuthor = element.querySelector(".z_author_icon");
    if (zAuthor) {
        post.zAuthor = true;
    }

    const date = element.querySelector(".date");
    if (date) {
        let dateText = date.textContent.trim();
        if (dateText.startsWith("投稿日：")) {
            dateText = dateText.slice(4);
        }
        post.date = dateText;
    }

    return post;
}

export async function getBookSettings({id, mode, zappToken}) {
    try {
        // Fetch the HTML content
        const url = mode === 'zapp' 
            ? `https://zapp.mangaz.com/v1/books/${id}/download` 
            : `https://vw.mangaz.com/virgo/view/${id}/`;
        const response = await axios.get(url, { headers: { 'X-Zapp-Code': zappToken ? zappToken : '' } });
        const html = response.data;

        // Parse HTML and find the span with id='doc'
        const dom = new JSDOM(html);
        const docElement = dom.window.document.querySelector('#doc');

        if (!docElement) {
            console.error('The specified element with id \'doc\' was not found.');
            return;
        }

        // Extract and decode the base64 string
        const base64EncodedString = docElement.textContent;
        const decodedString = Buffer.from(base64EncodedString, 'base64').toString('utf-8');

        // Parse the decoded string as JSON
        const settings = JSON.parse(decodedString);

        // console.log('Decoded settings:', settings);

        return settings;
    } catch (error) {
        throw error;
    }
}

async function descramble(order, image, dirName, totalCount, params) {
    const pageNo = getPageNo(order, totalCount)
    // console.log(`Descrambling image for ${pageNo}`);

    const { w: width, h: height, crops } = order.scramble;

    // Create a blank image with the target width and height
    const resultImage = new Jimp({ width, height, color: 0xFFFFFFFF }); // White background

    // Blit each crop onto the result image at the specified coordinates
    for (let crop of crops) {
        const { x, y, x2, y2, w, h } = crop;

        // Extract the crop from the original bitmap data
        const cropImage = image.clone().crop({ x: x2, y: y2, w, h });

        // Blit the crop onto the result image at the specified x, y position
        resultImage.blit({ src: cropImage, x, y });
    }

    // Save the result image
    const fileName = path.resolve(dirName, `${pageNo}.png`);

    if (params['sharp']) {
        await sharp(await resultImage.getBuffer("image/png"))
        .png({ compressionLevel: 9 })
        .toFile(fileName);
    } else {
        await resultImage.write(fileName);
    }
    
    if (params['oxipng']) {
        try {
            const { stdout, stderr } = await execFileAsync("oxipng", [fileName])
        } catch (error) {
            console.log(error);
        }
    } 
    // console.log(`Descrambled image saved as ${pageNo}.png`);
}

export async function processImage({ url, order, dirName, totalCount, params }) {
    const pageNo = getPageNo(order, totalCount)

    const fileName = path.resolve(dirName, `${pageNo}.png`);
    if (fs.existsSync(fileName)) {
        return true;
    }

    try {
        // Download image
        const response = await axios.get(url, { responseType: 'arraybuffer' });

        // const scrambledDir = path.resolve(dirName, 'scrambled');
        // fs.mkdirSync(scrambledDir, { recursive: true });
        // const scrambledFileName = path.resolve(scrambledDir, `${pageNo}.jpg`);
        // fs.writeFileSync(scrambledFileName, response.data);
        
        // Decode to bitmap data
        const image = await Jimp.read(response.data, { "image/jpeg": { maxMemoryUsageInMB: 2048 } });

        // Descramble and save
        await descramble(order, image, dirName, totalCount, params);

        // console.log(`Processed image ${pageNo}/${totalCount}`);
    } catch (error) {
        console.log(`Error processing image ${order.pageNo}/${totalCount}: ${error.message}`);
        console.log(error);
    }
}

export async function saveCoverImage({ url, dirName }) {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    let parts = url.split(".");

    const fileName = path.resolve(dirName, `cover.${parts[parts.length - 1]}`);
    if (fs.existsSync(fileName)) {
        return true;
    }

    fs.writeFileSync(fileName, response.data);
}

function getPageNo(order, totalCount) {
    return order.no.toString().padStart(totalCount.toString().length, "0");
}

// // Start processing with data passed from main script
// export default async (workerData) => {
//     // console.log(`Thread started for ${getPageNo(workerData.order, workerData.totalCount)}`);
//     // console.log(workerData);
//     await processImage(workerData);
// };