const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    MAX_TREE_DEPTH,
    canContainChildren,
    serializeListNode,
    slugify,
    splitPublicPath
} = require('../services/node-rules');
const uploadRules = require('../routes/upload')._test;

test('folder is the only node type that can contain children', () => {
    assert.equal(canContainChildren('folder'), true);
    assert.equal(canContainChildren('page'), false);
});

test('Vietnamese title is converted to a safe slug', () => {
    assert.equal(slugify('Kỹ thuật Tấn công Mạng'), 'ky-thuat-tan-cong-mang');
});

test('public path is bounded and only accepts safe slugs', () => {
    assert.deepEqual(
        splitPublicPath('/blog/web-security/sql-injection'),
        ['blog', 'web-security', 'sql-injection']
    );
    assert.throws(() => splitPublicPath('/blog/<script>'));
    assert.throws(() => splitPublicPath(`/${Array(MAX_TREE_DEPTH + 1).fill('a').join('/')}`));
});

test('sidebar serialization never includes page content or cover image', () => {
    const result = serializeListNode({
        _id: '1',
        title: 'SQL Injection',
        slug: 'sql-injection',
        type: 'page',
        parentId: '2',
        order: 0,
        isPublished: true,
        content: 'secret markdown',
        coverImage: '/uploads/cover.jpg'
    }, true);
    assert.equal(result.content, undefined);
    assert.equal(result.coverImage, undefined);
    assert.equal(result.hasChildren, false);
});

test('upload allowlist rejects executable, HTML and mismatched MIME types', () => {
    assert.equal(uploadRules.isAllowedImage('cover.png', 'image/png'), true);
    assert.equal(uploadRules.isAllowedImage('cover.svg', 'image/svg+xml'), false);
    assert.equal(uploadRules.isAllowedAttachment('lab.zip', 'application/zip'), true);
    assert.equal(uploadRules.isAllowedAttachment('payload.exe', 'application/octet-stream'), false);
    assert.equal(uploadRules.isAllowedAttachment('page.html', 'text/html'), false);
    assert.equal(uploadRules.isAllowedAttachment('fake.pdf', 'text/plain'), false);
});

test('Markdown renderer uses an explicit allowlist and forbids active content', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '../../frontend/assets/js/markdown-renderer.js'),
        'utf8'
    );
    for (const forbidden of ['"script"', '"iframe"', '"svg"', '"style"', '"form"']) {
        assert.match(source, new RegExp(forbidden));
    }
    assert.match(source, /ALLOWED_TAGS/);
    assert.match(source, /ALLOWED_ATTR/);
});
