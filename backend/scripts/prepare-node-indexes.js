const mongoose = require('mongoose');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });

const Node = require('../models/Node');

const OBSOLETE_INDEXES = new Set([
    'parentId_1',
    'path_1',
    'order_1',
    'isPublished_1',
    'parentId_1_order_1_title_1',
    'legacyPostId_1'
]);

async function main() {
    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI is missing from backend/.env');
    }

    const apply = process.argv.includes('--apply');
    await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });

    const collection = mongoose.connection.collection('nodes');
    const indexes = await collection.indexes();
    const removable = indexes
        .map((index) => index.name)
        .filter((name) => OBSOLETE_INDEXES.has(name));

    console.log(`Mode: ${apply ? 'apply' : 'dry-run'}`);
    console.log(`Obsolete indexes found: ${removable.length}`);
    for (const name of removable) console.log(`- ${name}`);

    if (!apply) {
        console.log('No database changes were made. Use --apply to update indexes.');
        await mongoose.disconnect();
        return;
    }

    for (const name of removable) {
        await collection.dropIndex(name);
        console.log(`Dropped: ${name}`);
    }

    await collection.createIndex(
        { parentId: 1, order: 1 },
        { name: 'parentId_1_order_1' }
    );
    await collection.createIndex(
        { parentId: 1, slug: 1 },
        { name: 'parentId_1_slug_1', unique: true }
    );

    console.log('Required indexes are ready.');
    console.log('Existing node documents and legacy fields were not modified.');
    await mongoose.disconnect();
}

main().catch(async (error) => {
    console.error(error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
