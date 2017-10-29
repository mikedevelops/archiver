const puppeteer = require('puppeteer');
const winston = require('winston');
const fs = require('fs');
const ms = require('ms');
const mongo = require('mongodb');

const URL = 'https://mobile.facebook.com/login.php?next=https%3A%2F%2Fmobile.facebook.com%2Fmichael.smart.33%2Fphotos&refsrc=https%3A%2F%2Fmobile.facebook.com%2Fmichael.smart.33%2Fphotos&_rdr';
const BASE = 'https://mobile.facebook.com';
const time = new Date();

/**
 * Print a Date object
 */
function printDate () {
    return `${time.getDate()}-${time.getUTCMonth()}-${time.getFullYear()}-${time.getHours()}:${time.getMinutes()}:${time.getSeconds()}`;
}

/**
 * Extract CLI options
 */
function options (args) {
    return args.reduce((options, arg) => {
        const test = arg.match(/--([\w\d-_]+)=([\w\d\W]+)/);

        if (test && test[1] && test[2]) {
            options[test[1]] = test[2];
        }

        return options;
    }, {});
}

const { resume } = options(process.argv.slice(2));

(async function () {
    // Start Puppeteer session
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    let collection;

    // Connect to the database
    try {
        collection = (await mongo.connect('mongodb://127.0.0.1:27017/facebook-photos')).collection('photos');
    } catch (error) {
        console.log('Could not connect to database');
        return;
    }

    // Navigate to first URL (we will be redirected to an auth page)
    await page.goto(URL);
    // Insert credentials
    await page.type('[name="email"]', '***************');
    await page.type('[name="pass"]', '****************');
    // Submit auth form
    await page.click('[name="login"]');

    // Wait for redirect
    try {
        await page.waitForNavigation();
    } catch (error) {
        console.log('Error waiting for page after login')
    }

    // Build first photo URL
    const first = resume || BASE + await page.$eval('.timeline.photos a:first-of-type', el => el.getAttribute('href'));
    // Keep track of photo count
    let photos = 0;
    let firstPhoto = '';

    /**
     * Recursive scrape function
     */
    async function getPhotoURL (start) {
        // Navigate to first photo
        await page.goto(start);

        let data;
        let date;

        // Extract photo date and click "view full size" link
        try {
            await page.waitForSelector('a[href*="view_full_size"]');

            try {
                const abbr = (await page.$$('abbr[data-sigil="timestamp"]')).pop();

                data = await page.evaluate(node => node.getAttribute('data-store'), abbr);

                if (data.length) {
                    date = new Date(JSON.parse(data).time * 1000);
                }
            } catch (error) {
                console.log('error getting date', error);
            }

            await page.click('a[href*="view_full_size"]');
        } catch (error) {
            const nodes = await page.$$('a');

            for (const node of nodes) {
                const html = await page.evaluate(foo => foo.innerHTML, node);

                if (html === 'View full size') {
                    await node.click();
                    break;
                }
            }
        }

        // Wait for photo to load
        try {
            await page.waitForNavigation();
        } catch (error) {
            console.log('Error waiting for photo');
        }

        // Store the photo fil URL
        const photo = page.url();

        if (photo) {
            // Determine if this is a duplicate
            const exists = await collection.findOne({ url: photo });

            // If we have a duplicate exit the process
            if (exists) {
                const dbPhotos = await collection.find().toArray();

                console.log(`Photos archived, found ${dbPhotos.length} photos`);
                return process.exit(0);
            }

            // Insert photo to the database
            collection.insert({ url: photo, page: start, date: date }, () => {
                logger.info(`Got photo "${photo}"`);
                photos++;
                process.stdout.clearLine();
                process.stdout.cursorTo(0);
                process.stdout.write(`Got ${photos} photos (${date})`);
            });
        }

        // Navigate back to where we started
        page.goto(start);

        try {
            await page.waitForNavigation();
        } catch (error) {
            console.log(`Error waiting for "${start}"`);
        }

        try {
            await page.waitForSelector('a[class*="_57-r"]');
        } catch (error) {
            console.log('Error waiting for "a[class*="_57-r"]"', error)
        }

        // Build the next photo link using the next UI element and the BASE URL
        const next = BASE + await page.$eval('a[class*="_57-r"]', node => node.getAttribute('href'));

        // Recursively get next photo
        return await getPhotoURL(next);
    }

    await getPhotoURL(first);
    logger.info(`Success! ${photos} photos found`);
})();
