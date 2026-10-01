const test = require('node:test');
const assert = require('node:assert/strict');

const {
    categoryForTitle,
    cleanMarkdown,
    collectDocumentSections,
    normalizeLabTitle,
    repairKnownDocumentIssues
} = require('../services/docx-writeup-importer');

test('DOCX lab title prefixes are removed without changing the lab name', () => {
    assert.equal(
        normalizeLabTitle('Bài Lab: SQL injection vulnerability allowing login bypass'),
        'SQL injection vulnerability allowing login bypass'
    );
    assert.equal(
        normalizeLabTitle('Bài LAB Username enumeration via different responses'),
        'Username enumeration via different responses'
    );
});

test('PortSwigger labs are assigned to the expected categories', () => {
    assert.equal(
        categoryForTitle('SQL injection UNION attack').slug,
        'sql-injection'
    );
    assert.equal(
        categoryForTitle('DOM XSS in document.write sink').slug,
        'cross-site-scripting'
    );
    assert.equal(
        categoryForTitle('2FA simple bypass').slug,
        'authentication'
    );
    assert.equal(
        categoryForTitle('Method-based access control can be circumvented').slug,
        'access-control'
    );
    assert.equal(
        categoryForTitle('File path traversal, simple case').slug,
        'path-traversal'
    );
    assert.equal(
        categoryForTitle('Remote code execution via web shell upload').slug,
        'file-upload'
    );
    assert.equal(
        categoryForTitle('CSRF vulnerability with no defenses').slug,
        'csrf'
    );
    assert.equal(
        categoryForTitle('Basic SSRF against another back-end system').slug,
        'ssrf'
    );
});

test('converted HTML is split into setup and individual lab sections', () => {
    const sections = collectDocumentSections([
        '<h1>Ngày 1 Setup + HTTP / Burp</h1>',
        '<p>Setup content</p>',
        '<h1>Ngày 2</h1>',
        '<h2>Bài Lab: SQL injection login bypass</h2>',
        '<p>SQL content</p>',
        '<h1>Ngày 3</h1>',
        '<h2>Bài Lab: Reflected XSS</h2>',
        '<p>XSS content</p>'
    ].join(''));

    assert.match(sections.setupHtml, /Setup content/);
    assert.equal(sections.labs.length, 2);
    assert.equal(sections.labs[0].title, 'SQL injection login bypass');
    assert.doesNotMatch(sections.labs[0].html, /Ngày 3/);
    assert.equal(sections.labs[1].title, 'Reflected XSS');
});

test('known missing week-two upload heading is restored before splitting', () => {
    const repaired = repairKnownDocumentIssues([
        '<h1>Ngày 2</h1>',
        '<p>Mục tiêu: Hiểu cách chức năng tải tệp tin lên hệ thống bị khai thác do thiếu kiểm tra loại tệp tin, từ đó chèn mã độc.</p>',
        '<h3>Thông tin chung</h3>'
    ].join(''));

    assert.match(
        repaired,
        /<h2>Bài Lab: Remote code execution via web shell upload<\/h2>/
    );
});

test('technical HTML is rendered as code while imported tables stay intact', () => {
    const markdown = cleanMarkdown([
        'Payload: *<script>alert(1)</script>*',
        '',
        '<table><tbody><tr><td><p>Value</p></td></tr></tbody></table>'
    ].join('\n'));

    assert.match(markdown, /`<script>alert\(1\)<\/script>`/);
    assert.match(markdown, /<table>/);
    assert.match(markdown, /<p>Value<\/p>/);
});

test('italic code paragraphs after a language label become a fenced block', () => {
    const markdown = cleanMarkdown([
        'Javasscript',
        '',
        '*const input = req.query.search;*',
        '',
        '*res.send(input);*'
    ].join('\n'));

    assert.match(markdown, /```javascript/);
    assert.match(markdown, /const input = req\.query\.search;/);
    assert.match(markdown, /res\.send\(input\);/);
});
