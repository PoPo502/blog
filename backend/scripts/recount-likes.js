const mongoose = require('mongoose');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });

const Node = require('../models/Node');
const PageReaction = require('../models/PageReaction');

async function main() {
    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI is missing from backend/.env');
    }

    const apply = process.argv.includes('--apply');
    await mongoose.connect(process.env.MONGODB_URI);

    const counts = await PageReaction.aggregate([
        { $group: { _id: '$nodeId', likes: { $sum: 1 } } }
    ]);
    const countByNode = new Map(
        counts.map((entry) => [String(entry._id), entry.likes])
    );
    const pages = await Node.find({ type: 'page' }).select('_id title likes').lean();
    const changes = pages
        .map((page) => ({
            _id: page._id,
            title: page.title,
            oldLikes: Math.max(0, Number(page.likes || 0)),
            newLikes: countByNode.get(String(page._id)) || 0
        }))
        .filter((page) => page.oldLikes !== page.newLikes);

    console.log(`Mode: ${apply ? 'apply' : 'dry-run'}`);
    console.log(`Pages checked: ${pages.length}`);
    console.log(`Pages to update: ${changes.length}`);
    for (const change of changes) {
        console.log(`${change.title}: ${change.oldLikes} -> ${change.newLikes}`);
    }

    if (apply && changes.length > 0) {
        await Node.bulkWrite(changes.map((change) => ({
            updateOne: {
                filter: { _id: change._id, type: 'page' },
                update: { $set: { likes: change.newLikes } }
            }
        })));
        console.log('Like counters were synchronized.');
    } else if (!apply) {
        console.log('No database changes were made. Use --apply to synchronize counters.');
    }

    await mongoose.disconnect();
}

main().catch(async (error) => {
    console.error(error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
