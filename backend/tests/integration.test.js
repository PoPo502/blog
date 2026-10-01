const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    after,
    before,
    beforeEach,
    test
} = require('node:test');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pq-blog-test-'));
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/pq-blog-test';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-and-random-enough';
process.env.VISITOR_HASH_SECRET = 'different-test-visitor-secret-that-is-long-enough';
process.env.UPLOAD_DIR = uploadDir;

const { app } = require('../server');
const Node = require('../models/Node');
const PageReaction = require('../models/PageReaction');
const User = require('../models/User');

const ADMIN_USERNAME = 'test-admin';
const ADMIN_PASSWORD = 'test-password-123!';
const VISITOR_ONE = '11111111-1111-4111-8111-111111111111';
const VISITOR_TWO = '22222222-2222-4222-8222-222222222222';

let replSet;
let admin;
let publicFolder;
let publicPage;
let draftFolder;
let hiddenPage;

async function createFixtures() {
    publicFolder = await Node.create({
        title: 'Public folder',
        slug: 'public-folder',
        type: 'folder',
        parentId: null,
        order: 0,
        isPublished: true
    });
    publicPage = await Node.create({
        title: 'Public page',
        slug: 'public-page',
        type: 'page',
        parentId: publicFolder._id,
        order: 0,
        content: '# Public',
        isPublished: true
    });
    draftFolder = await Node.create({
        title: 'Draft folder',
        slug: 'draft-folder',
        type: 'folder',
        parentId: null,
        order: 1,
        isPublished: false
    });
    hiddenPage = await Node.create({
        title: 'Hidden page',
        slug: 'hidden-page',
        type: 'page',
        parentId: draftFolder._id,
        order: 0,
        content: '# Hidden',
        isPublished: true
    });
}

async function uploadAttachment(pageId, filename = 'lab.txt') {
    const response = await admin
        .post('/api/upload/attachment')
        .field('nodeId', String(pageId))
        .attach('file', Buffer.from('safe lab file'), {
            filename,
            contentType: 'text/plain'
        });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body;
}

before(async () => {
    replSet = await MongoMemoryReplSet.create({
        replSet: { count: 1, storageEngine: 'wiredTiger' }
    });
    await mongoose.connect(replSet.getUri());
    await Promise.all([Node.init(), PageReaction.init(), User.init()]);
    await User.create({
        username: ADMIN_USERNAME,
        password: ADMIN_PASSWORD
    });
    admin = request.agent(app);
    const login = await admin.post('/api/auth/login').send({
        username: ADMIN_USERNAME,
        password: ADMIN_PASSWORD
    });
    assert.equal(login.status, 200);
});

beforeEach(async () => {
    await Promise.all([
        Node.deleteMany({}),
        PageReaction.deleteMany({})
    ]);
    for (const filename of await fs.promises.readdir(uploadDir)) {
        await fs.promises.unlink(path.join(uploadDir, filename));
    }
    await createFixtures();
});

after(async () => {
    await mongoose.disconnect();
    await replSet.stop();
    await fs.promises.rm(uploadDir, { recursive: true, force: true });
});

test('public reader can read public page but cannot read draft ancestry', async () => {
    const publicResponse = await request(app).get(`/api/nodes/${publicPage._id}`);
    assert.equal(publicResponse.status, 200);
    assert.equal(publicResponse.body.title, 'Public page');

    const hiddenResponse = await request(app).get(`/api/nodes/${hiddenPage._id}`);
    assert.equal(hiddenResponse.status, 404);
});

test('public reader cannot mutate nodes while Admin can create a page', async () => {
    const payload = {
        title: 'Created page',
        slug: 'created-page',
        type: 'page',
        parentId: String(publicFolder._id),
        isPublished: true
    };
    assert.equal((await request(app).post('/api/nodes').send(payload)).status, 401);
    assert.equal((
        await request(app)
            .put(`/api/nodes/${publicPage._id}`)
            .send({ title: 'Unauthorized' })
    ).status, 401);
    assert.equal((
        await request(app).delete(`/api/nodes/${publicPage._id}`)
    ).status, 401);

    const created = await admin.post('/api/nodes').send(payload);
    assert.equal(created.status, 201);
    assert.equal(created.body.title, 'Created page');
});

test('view endpoint increments public page atomically and list/detail reads do not', async () => {
    await request(app).get(`/api/nodes?parentId=${publicFolder._id}`);
    await admin.get(`/api/nodes/${publicPage._id}?includeDrafts=1`);
    assert.equal((await Node.findById(publicPage._id).lean()).views, 0);

    const [first, second] = await Promise.all([
        request(app).post(`/api/nodes/${publicPage._id}/view`),
        request(app).post(`/api/nodes/${publicPage._id}/view`)
    ]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal((await Node.findById(publicPage._id).lean()).views, 2);
});

test('folder and draft page cannot record views', async () => {
    assert.equal((
        await request(app).post(`/api/nodes/${publicFolder._id}/view`)
    ).status, 404);
    assert.equal((
        await request(app).post(`/api/nodes/${hiddenPage._id}/view`)
    ).status, 404);
    assert.equal((await Node.findById(hiddenPage._id).lean()).views, 0);
});

test('Admin update cannot directly overwrite views or likes', async () => {
    await Node.updateOne(
        { _id: publicPage._id },
        { $set: { views: 4, likes: 3 } }
    );
    const response = await admin
        .put(`/api/nodes/${publicPage._id}`)
        .send({
            title: 'Public page updated',
            views: 999999,
            likes: 999999
        });
    assert.equal(response.status, 200);
    const current = await Node.findById(publicPage._id).lean();
    assert.equal(current.views, 4);
    assert.equal(current.likes, 3);
});

test('same visitor like is idempotent and a different visitor can like', async () => {
    const like = (visitorId) => request(app)
        .post(`/api/nodes/${publicPage._id}/like`)
        .set('X-Visitor-ID', visitorId)
        .send({ action: 'like' });

    const first = await like(VISITOR_ONE);
    const repeated = await like(VISITOR_ONE);
    const secondVisitor = await like(VISITOR_TWO);
    assert.equal(first.status, 200);
    assert.equal(repeated.status, 200);
    assert.equal(secondVisitor.status, 200);
    assert.equal(repeated.body.likes, 1);
    assert.equal(secondVisitor.body.likes, 2);
    assert.equal(await PageReaction.countDocuments({ nodeId: publicPage._id }), 2);

    const stored = await PageReaction.findOne({ nodeId: publicPage._id }).lean();
    assert.notEqual(stored.visitorHash, VISITOR_ONE);
    assert.equal(stored.visitorHash.length, 64);
});

test('concurrent likes from the same visitor create one reaction', async () => {
    const responses = await Promise.all([
        request(app)
            .post(`/api/nodes/${publicPage._id}/like`)
            .set('X-Visitor-ID', VISITOR_ONE)
            .send({ action: 'like' }),
        request(app)
            .post(`/api/nodes/${publicPage._id}/like`)
            .set('X-Visitor-ID', VISITOR_ONE)
            .send({ action: 'like' })
    ]);
    assert.equal(responses[0].status, 200);
    assert.equal(responses[1].status, 200);
    assert.equal(await PageReaction.countDocuments({ nodeId: publicPage._id }), 1);
    assert.equal((await Node.findById(publicPage._id).lean()).likes, 1);
});

test('unlike is idempotent and never makes likes negative', async () => {
    const endpoint = `/api/nodes/${publicPage._id}/like`;
    await request(app)
        .post(endpoint)
        .set('X-Visitor-ID', VISITOR_ONE)
        .send({ action: 'like' });
    const first = await request(app)
        .post(endpoint)
        .set('X-Visitor-ID', VISITOR_ONE)
        .send({ action: 'unlike' });
    const repeated = await request(app)
        .post(endpoint)
        .set('X-Visitor-ID', VISITOR_ONE)
        .send({ action: 'unlike' });
    assert.equal(first.status, 200);
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.likes, 0);
    assert.equal((await Node.findById(publicPage._id).lean()).likes, 0);
});

test('like rejects invalid visitor, folder and draft page', async () => {
    assert.equal((
        await request(app)
            .post(`/api/nodes/${publicPage._id}/like`)
            .set('X-Visitor-ID', 'not-a-uuid')
            .send({ action: 'like' })
    ).status, 400);
    assert.equal((
        await request(app)
            .post(`/api/nodes/${publicFolder._id}/like`)
            .set('X-Visitor-ID', VISITOR_ONE)
            .send({ action: 'like' })
    ).status, 404);
    assert.equal((
        await request(app)
            .post(`/api/nodes/${hiddenPage._id}/like`)
            .set('X-Visitor-ID', VISITOR_ONE)
            .send({ action: 'like' })
    ).status, 404);
});

test('reaction status only exposes the current visitor state', async () => {
    await request(app)
        .post(`/api/nodes/${publicPage._id}/like`)
        .set('X-Visitor-ID', VISITOR_ONE)
        .send({ action: 'like' });
    const liked = await request(app)
        .get(`/api/nodes/${publicPage._id}/reaction`)
        .set('X-Visitor-ID', VISITOR_ONE);
    const notLiked = await request(app)
        .get(`/api/nodes/${publicPage._id}/reaction`)
        .set('X-Visitor-ID', VISITOR_TWO);
    assert.deepEqual(liked.body, { likes: 1, liked: true });
    assert.deepEqual(notLiked.body, { likes: 1, liked: false });
});

test('public attachment download checks page relation and secure headers', async () => {
    const attachment = await uploadAttachment(publicPage._id);
    const download = await request(app).get(attachment.url);
    assert.equal(download.status, 200);
    assert.match(download.headers['content-disposition'], /attachment/i);
    assert.equal(download.headers['x-content-type-options'], 'nosniff');

    const otherPage = await Node.create({
        title: 'Other page',
        slug: 'other-page',
        type: 'page',
        parentId: publicFolder._id,
        order: 1,
        isPublished: true
    });
    assert.equal((
        await request(app).get(
            `/api/nodes/${otherPage._id}/attachments/${attachment._id}/download`
        )
    ).status, 404);
    assert.equal((
        await request(app).get(
            `/api/nodes/${publicPage._id}/attachments/not-an-id/download`
        )
    ).status, 404);
    assert.equal((
        await request(app).get(
            `/api/nodes/${publicPage._id}/attachments/%2e%2e%2fsecret/download`
        )
    ).status, 404);
});

test('draft attachment is hidden from public but downloadable by Admin', async () => {
    const attachment = await uploadAttachment(hiddenPage._id, 'draft.txt');
    assert.equal((await request(app).get(attachment.url)).status, 404);
    const adminDownload = await admin.get(attachment.url);
    assert.equal(adminDownload.status, 200);
    assert.match(adminDownload.headers['content-disposition'], /attachment/i);
});

test('legacy filename download route is not public', async () => {
    const attachment = await uploadAttachment(publicPage._id);
    assert.equal((
        await request(app).get(`/api/upload/files/${attachment.storedName}`)
    ).status, 401);
});

test('public page under draft ancestor cannot read, view, like or download', async () => {
    const attachment = await uploadAttachment(hiddenPage._id, 'hidden.txt');
    assert.equal((await request(app).get(`/api/nodes/${hiddenPage._id}`)).status, 404);
    assert.equal((
        await request(app).post(`/api/nodes/${hiddenPage._id}/view`)
    ).status, 404);
    assert.equal((
        await request(app)
            .post(`/api/nodes/${hiddenPage._id}/like`)
            .set('X-Visitor-ID', VISITOR_ONE)
            .send({ action: 'like' })
    ).status, 404);
    assert.equal((await request(app).get(attachment.url)).status, 404);
});
