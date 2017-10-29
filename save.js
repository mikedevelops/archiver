const mongo = require('mongodb');
const path = require('path');
const fs = require('fs');
const request = require('request-promise-native');

(async function () {
    // Establish connection to database
    const db = await mongo.connect('mongodb://127.0.0.1:27017/facebook-photos');
    const photos = await db.collection('photos').find().toArray();
    const total = photos.length;
    let counter = 1;
    let requests = [];

    /**
     * Save photo to disk
     */
    function saveToDisk (photo) {
        return new Promise((resolve, reject) => {
            // Create write stream
            const stream = fs.createWriteStream(`tmp/${photo.date} ${photo._id}.jpg`);

            // Request photo URL
            try {
                request(photo.url).pipe(stream);
            } catch (error) {
                reject({ error, photo });
            }

            // Increment counter and set a downloaded flag on database entry
            stream.on('finish', () => {
                db.collection('photos').findOneAndUpdate(
                    { _id: photo._id },
                    Object.assign({}, photo, { downloaded: true })
                );

                process.stdout.clearLine();
                process.stdout.cursorTo(0);
                process.stdout.write(`${counter}/${total} downloaded`);
                counter++;
                resolve();
            });

            stream.on('error', () => {
                reject({ error, photo });
            });
        });
    }

    // Download and save each photo
    for (const photo of photos) {
        try {
            await saveToDisk(photo);
        } catch (error) {
            console.log(`Error with ${photo.page}`, error);
        }
    }

    console.log('\nFin.');
    process.exit(0);
})();
