import fs from 'fs';
import { resolve } from 'path';

async function run() {
    const inDir = 'bookSettingsCache';
    const files = fs.readdirSync(inDir); //.slice(0, 10);
    let books = [];
    let series = {};
    for (let file of files) {
        const id = file.split(".")[0];
        const settings = JSON.parse(fs.readFileSync(resolve(inDir, file), 'utf-8'));
        books.push({
            id: id, 
            seriesId: settings.Book.series_id,
            title: '"' + settings.Book.title.replaceAll('"', '') + (settings.Book.volume ? ' - ' + settings.Book.volume.replaceAll('"', '') : '') + '"',
            r18: !!settings.Book.r18,
        })
        // series[settings.Book.series_id] = {
        //     id: settings.Book.series_id, 
        //     title: '"' + settings.Book.title.replaceAll('"', '') + '"',
        //     r18: !!settings.Book.r18,
        // }        
        if (!settings.Book.series_id) {
            console.log(`Book ${id} has no series ID!`);
        }
    }

    fs.writeFileSync('all_books.csv', books.sort((a, b) => a.id - b.id).map(it => `${it.id}, ${it.seriesId}, ${it.title}, ${it.r18 ? 'r18' : 'www'}`).join('\n'), 'utf-8');
    // fs.writeFileSync('all_series.csv', Object.values(series).sort((a, b) => a.id - b.id).map(it => `${it.id}, ${it.title}, ${it.r18 ? 'r18' : 'www'}`).join('\n'), 'utf-8');
}

run();
