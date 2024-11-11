const fs = require('fs');
const axios = require('axios');

async function run() {
    let page = 0
    
    let url = "https://www.mangaz.com/title/addpage_renewal?query=&category=&type=&search=input&sort=new&page=";
    
    let response = "response";

    const results = [];

    while(response = (await axios(url + page, { headers: { 'X-Requested-With': 'XMLHttpRequest' }})).data) {
        console.log("Processing page " + page);
        const matches = response.matchAll(/\<h4\>\<a href="https:\/\/(www|r18).mangaz.com\/series\/detail\/(\d+)"\>(.*?)<\/a><\/h4>/g)
        const matchArray = [...matches];

        fs.appendFileSync("scrape.csv", matchArray.map(it => `/series/detail/${it[2]},${it[3]},${it[1]}`).join("\n") + "\n");

        page++;
    }

}

run();