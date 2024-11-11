Before using install NodeJS and run `npm install` in this directory. Tested on NodeJS 22, seemingly functions on 18. 

After you run `npm install`, go to file `node_modules\jpeg-js\lib\decoder.js`, find the line `maxMemoryUsageInMB: 512` (in the current version line 1106) and change that to `maxMemoryUsageInMB: 2048`. Unfortunately, the Jimp library is not overriding this jpeg-js parameter correctly, so you have to change it in the jpeg-js code itself. Without this, very large images such as the ones in book ID 187162 will fail to download, although this will not be an issue for 99.9% of the books.

Usage examples:

By book id:

`node mzrip.js 163491`

By book URL:

`node mzrip.js https://www.mangaz.com/book/detail/163491`

By series URL:

`node mzrip.js https://www.mangaz.com/series/detail/159901`

Optimize PNGs with sharp (may not work on Windows 7 and below):

`node mzrip.js --sharp -- https://www.mangaz.com/series/detail/159901`

Optimize PNGs with oxipng (you have to download oxipng, then place the oxipng executable into this folder or into PATH):

`node mzrip.js --oxipng -- https://www.mangaz.com/series/detail/159901`

Optional parameters:
* `threads`: number of threads to use, default - 10.
* `out`: directory to save the book files into, default - Downloads. It can always be the same directory, as the script creates subdirectories based on the book title and volume number.

Yes, yes, ChatGPT wrote some of the bootstrap for this, don't blame me for being lazy, this script will only live for a month until MangaZ dies. This is also why it's _emphatically_ not managing memory or threads well, corners were cut.

On Windows 7 you may have to remove `import sharp` line from `mzworker.mjs`. Can't figure out how to make it a conditional import, and the file has to be an ESM module because of some NodeJS/Piscina issue with `require` failing in the worker file otherwise. I'm not a JS guru, plz understando.

----------------------

Download all series listed in the attached CSV from lines `from` to `to` (which default to 1 and line number respectively):

`node mzrip_csv.js series.csv --from=1000 --to=1999 --threads=10 --out=Downloads` 

CSV made by a kind anon from /a/, a scrape of all series IDs discoverable on the website, which is only missing a select few unlisted titles such as series ID 4681.

----------------------

Ignore this mess, but this tries to find all possible IDs by directly requesting them and downloading the metadata. Doesn't generate a list of IDs because I want to use it in a different way (i.e. directly reuse downloaded metadata). Very slow and prone to crashing for reasons beyond my comprehension.

`node mzscrape.js --threads=10 --from=1 --to=300000 --out=scrape`

----------------------

Download only scrambled files and raw HTML info/comments from the attached CSV:

`node mz_ripscrambled_csv.js all_series.csv --from=1 --to=7000 --minDelayMS=50 --threads=10 --bookSettingsCache=bookSettingsCacheCompact --includeR18 --out=Downloads`

`--includeR18` - remove if you don't want the R18 content, it will be skipped
`--minDelayMs` - how many milliseconds to wait between starting image downloads, decreasing improves download speed, but also risks DDoS-ing the server or getting banned, I use 10 but I'm a risky anon
`--threads=10` - how many threads to use for download, modify according to your network speed (I use 20 and get like 80-100Mbps). Unlike the previous batch downloader, here the number does not affect CPU much, as only light Node threads are used, which will suspend while download is happening.
`--bookSettingsCache` - directory where book settings are stored - you can download the 7z, extract it, and point the script at the directory. This improves speed a little (no need to download settings before downloading pages), though not drastically.

`series.csv`, `series_2.csv`, and `all_series.csv` should all work, the latter is my scrape based on what book IDs were actually available to download, so it doesn't contain "waiting for approval" or fake IDs like 9901-9903

Directory structure is changed, but a bit too drastically, so no script to fix what is already downloaded, sorry. The previous structure was a bit too prone to fuck-ups...

----------------------

Descramble downloaded scrambled files

`node mz_descramble.js --from=1 --to=1000 --threads=10 --oxipng --out=D:\MangaZ\Descrambled\WWW -- D:\MangaZ\Downloads\WWW`

This will descramble folders from 1 to 1000 in D:\MangaZ\Downloads\WWW, probably in ~alphabetical order. The script checks folders recursively, so for any folder where it finds 'metadata\metadata.html' it will run the descrambling, no matter how deep.

`--oxipng` for PNG optimization
`--sharp` to use Sharp instead of Jimp, which may be a little faster as it's native code and not pure Javascript. Size-wise _not_ using sharp but using oxipng has been the most compact, maybe Jimp strips some not-so-needed stuff. You will probably run just --oxipng without --sharp, and I will likely do the same.