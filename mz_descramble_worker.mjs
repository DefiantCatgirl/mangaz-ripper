import { Jimp } from "jimp";
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { JSDOM } from 'jsdom';
import path from 'path';
import util from 'node:util';

const execFileAsync = util.promisify(execFile);

export async function descrambleImageJimp({ scrambledFilename, fileName, order }) {
    const { w: width, h: height, crops } = order.scramble;

    const image = await Jimp.read(scrambledFilename);

    const resultImage = new Jimp({ width, height, color: 0xFFFFFFFF });

    for (let crop of crops) {
        const { x, y, x2, y2, w, h } = crop;

        const cropImage = image.clone().crop({ x: x2, y: y2, w, h });

        resultImage.blit({ src: cropImage, x, y });
    }

    await resultImage.write(fileName);
}

export async function runOxipng({ fileName }) {
    return await execFileAsync("oxipng", [fileName]);
}

async function fileExists(filePath) {
    return fs.access(filePath).then(() => true, () => false)
}

export async function getBookPageInfo({dir, outDir}) {
    try {
        if (await fileExists(path.resolve(outDir, 'metadata', 'info.json'))) {
            return true;
        }
        
        const html = await fs.readFile(path.resolve(dir, 'metadata', 'info.html'), 'utf-8');

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

        fs.writeFile(
            path.resolve(outDir, 'metadata', 'info.json'),
            JSON.stringify(info, null, 2),
            'utf-8'
        );

        fs.writeFile(
            path.resolve(outDir, 'metadata', 'info.html'),
            html,
            'utf-8'
        );
    } catch (error) {
        console.log(error);
        console.log("Failed to parse book information");
    }
}

export async function getCommentsPage({dir, outDir}) {
    try {
        if (await fileExists(path.resolve(outDir, 'metadata', 'comments.json'))) {
            return true;
        }

        const html = await fs.readFile(path.resolve(dir, 'metadata', 'comments.html'), 'utf-8');
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

        fs.writeFile(
            path.resolve(outDir, 'metadata', 'comments.json'),
            JSON.stringify({ comments }, null, 2),
            'utf-8'
        );

        fs.writeFile(
            path.resolve(outDir, 'metadata', 'comments.html'),
            html,
            'utf-8'
        );
    } catch (error) {
        console.log(error);
        console.log("Failed to parse comments");
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

export async function copyCover({ dir, outDir }) {
    const files = (await fs.readdir(path.resolve(dir, 'metadata'))).filter(it => it.startsWith('cover'));
    let nonExisting = (await Promise.all(files.map(async it => {
        if (await fileExists(path.resolve(outDir, 'metadata', it))) {
            return null;
        } else {
            return it;
        }
    }))).filter(it => it);
    if (nonExisting.length > 0) {
        await Promise.all(nonExisting.map(it => fs.copyFile(path.resolve(dir, 'metadata', it), path.resolve(outDir, 'metadata', it))));
        return;
    } else {
        return true;
    }
}

export async function copyMetadata({ dir, outDir }) {
    const files = (await fs.readdir(path.resolve(dir, 'metadata'))).filter(it => it.startsWith('metadata'));
    let nonExisting = (await Promise.all(files.map(async it => {
        if (await fileExists(path.resolve(outDir, 'metadata', it))) {
            return null;
        } else {
            return it;
        }
    }))).filter(it => it);
    if (nonExisting.length > 0) {
        await Promise.all(nonExisting.map(it => fs.copyFile(path.resolve(dir, 'metadata', it), path.resolve(outDir, 'metadata', it))));
        return;
    } else {
        return true;
    }
}
