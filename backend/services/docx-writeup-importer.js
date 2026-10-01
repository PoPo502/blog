const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');
const { cleanTags, slugify } = require('./node-rules');

const STYLE_MAP = [
    "p[style-name='toc 1'] => !",
    "p[style-name='toc 2'] => !",
    "p[style-name='toc 3'] => !",
    "p[style-name='BTL-H0'] => h1:fresh",
    "p[style-name='BTL-H1'] => h1:fresh",
    "p[style-name='BTL-H2'] => h2:fresh",
    "p[style-name='BTL-H3'] => h3:fresh",
    "p[style-name='BTL-H4'] => h4:fresh",
    "p[style-name='BTL-Text'] => p:fresh",
    "p[style-name='BTL-Bullet1'] => ul > li:fresh",
    "p[style-name='BTL-Bullet2'] => ul > li:fresh",
    "p[style-name='code BC'] => pre:separator('\\n')",
    "r[style-name='code BC Char'] => code",
    "r[style-name='code Char'] => code"
];

const CATEGORY_DEFINITIONS = [
    {
        title: 'SQL Injection',
        slug: 'sql-injection',
        tags: ['portswigger', 'sql-injection', 'lab'],
        matches(title) {
            return title.toLowerCase().includes('sql injection');
        }
    },
    {
        title: 'Cross-Site Scripting',
        slug: 'cross-site-scripting',
        tags: ['portswigger', 'xss', 'lab'],
        matches(title) {
            return /\bxss\b|cross-site scripting/i.test(title);
        }
    },
    {
        title: 'Authentication',
        slug: 'authentication',
        tags: ['portswigger', 'authentication', 'lab'],
        matches(title) {
            return /username enumeration|2fa|password reset/i.test(title);
        }
    },
    {
        title: 'Access Control',
        slug: 'access-control',
        tags: ['portswigger', 'access-control', 'lab'],
        matches(title) {
            return /unprotected admin|user role|method-based access control/i.test(title);
        }
    },
    {
        title: 'Path Traversal',
        slug: 'path-traversal',
        tags: ['portswigger', 'path-traversal', 'lab'],
        matches(title) {
            return /path traversal/i.test(title) && !/web shell upload/i.test(title);
        }
    },
    {
        title: 'File Upload Vulnerabilities',
        slug: 'file-upload',
        tags: ['portswigger', 'file-upload', 'lab'],
        matches(title) {
            return /file upload|web shell upload/i.test(title);
        }
    },
    {
        title: 'Cross-Site Request Forgery',
        slug: 'csrf',
        tags: ['portswigger', 'csrf', 'lab'],
        matches(title) {
            return /\bcsrf\b/i.test(title);
        }
    },
    {
        title: 'Server-Side Request Forgery',
        slug: 'ssrf',
        tags: ['portswigger', 'ssrf', 'lab'],
        matches(title) {
            return /\bssrf\b/i.test(title);
        }
    }
];

const IMAGE_EXTENSIONS = new Map([
    ['image/gif', '.gif'],
    ['image/jpeg', '.jpg'],
    ['image/png', '.png'],
    ['image/webp', '.webp']
]);

const SCOPE_NOTE = [
    '> **Phạm vi sử dụng:** Nội dung chỉ phục vụ học tập trong PortSwigger Web Security Academy',
    '> hoặc môi trường được phép kiểm thử. Không áp dụng lên hệ thống thật khi chưa có ủy quyền.'
].join('\n');

function decodeHtmlText(value) {
    return String(value || '')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;|&#160;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeLabTitle(value) {
    return decodeHtmlText(value)
        .replace(/^Bài\s+LAB\s*:?\s*/i, '')
        .replace(/^Bài\s+Lab\s*:?\s*/i, '')
        .trim();
}

function categoryForTitle(title) {
    const category = CATEGORY_DEFINITIONS.find((item) => item.matches(title));
    if (!category) {
        throw new Error(`Không xác định được nhóm lỗ hổng cho bài: ${title}`);
    }
    return category;
}

function createTurndownService() {
    const turndown = new TurndownService({
        bulletListMarker: '-',
        codeBlockStyle: 'fenced',
        emDelimiter: '*',
        headingStyle: 'atx'
    });
    turndown.use(gfm);
    turndown.addRule('preserveImportedTables', {
        filter: 'table',
        replacement(content, node) {
            return `\n\n${node.outerHTML || String(node)}\n\n`;
        }
    });
    turndown.addRule('fencedPreformattedText', {
        filter: 'pre',
        replacement(content, node) {
            const code = String(node.textContent || '')
                .replace(/\r\n?/g, '\n')
                .replace(/^\n+|\n+$/g, '');
            return `\n\n\`\`\`\n${code}\n\`\`\`\n\n`;
        }
    });
    return turndown;
}

function codeLanguage(value) {
    const label = String(value || '')
        .replace(/[*_`/]/g, '')
        .trim()
        .toLowerCase();
    if (/^java\s*script$|^javas+cript$/.test(label)) return 'javascript';
    if (label === 'sql') return 'sql';
    if (label === 'http') return 'http';
    if (label === 'php') return 'php';
    if (label === 'html' || label === 'xml') return 'html';
    return '';
}

function convertLabeledCodeBlocks(value) {
    const paragraphs = String(value || '').split(/\n{2,}/);
    const output = [];

    for (let index = 0; index < paragraphs.length; index += 1) {
        const language = codeLanguage(paragraphs[index]);
        if (!language) {
            output.push(paragraphs[index]);
            continue;
        }

        const next = String(paragraphs[index + 1] || '').trim();
        if (next.startsWith('```')) {
            output.push(next.replace(/^```\s*$/m, `\`\`\`${language}`));
            index += 1;
            continue;
        }

        const codeLines = [];
        let cursor = index + 1;
        while (cursor < paragraphs.length) {
            const paragraph = String(paragraphs[cursor] || '').trim();
            if (/^\*\*|^__/.test(paragraph)) break;
            const match = paragraph.match(/^\*([\s\S]+)\*$/);
            if (!match) break;
            const line = match[1].replace(/\\`/g, '`');
            if (codeLines.length === 0 && !/[=;{}<>$`()]/.test(line)) break;
            codeLines.push(line);
            cursor += 1;
        }

        if (codeLines.length >= 2) {
            output.push(`\`\`\`${language}\n${codeLines.join('\n')}\n\`\`\``);
            index = cursor - 1;
        } else {
            output.push(paragraphs[index]);
        }
    }

    return output.join('\n\n');
}

function protectTechnicalHtml(value) {
    const protectedBlocks = [];
    let content = String(value || '').replace(
        /```[\s\S]*?```|<table\b[\s\S]*?<\/table>/gi,
        (block) => {
            const token = `DOCX_PROTECTED_BLOCK_${protectedBlocks.length}`;
            protectedBlocks.push(block);
            return token;
        }
    );

    content = content
        .replace(
            /<(script|h[1-6]|p|svg|iframe|form|a)\b[^>\n]*>[^\n]*?<\/\1>/gi,
            (snippet) => `\`${snippet.replace(/`/g, '\\`')}\``
        )
        .replace(
            /<\?php[^\n]*\?>/gi,
            (snippet) => `\`${snippet.replace(/`/g, '\\`')}\``
        )
        .replace(
            /<(img|input)\b[^>\n]*\/?>/gi,
            (snippet) => `\`${snippet.replace(/`/g, '\\`')}\``
        )
        .replace(/\*(`[^`\n]+`)\*/g, '$1');

    const inlineCode = [];
    content = content.replace(/`[^`\n]+`/g, (snippet) => {
        const token = `DOCX_INLINE_CODE_${inlineCode.length}`;
        inlineCode.push(snippet);
        return token;
    });
    content = content.replace(
        /<\/?(script|h[1-6]|p|svg|iframe|form|img|input|a)\b[^>\n]*>/gi,
        (snippet) => `\`${snippet.replace(/`/g, '\\`')}\``
    );
    for (let index = 0; index < inlineCode.length; index += 1) {
        content = content.replace(`DOCX_INLINE_CODE_${index}`, inlineCode[index]);
    }

    for (let index = 0; index < protectedBlocks.length; index += 1) {
        content = content.replace(
            `DOCX_PROTECTED_BLOCK_${index}`,
            protectedBlocks[index]
        );
    }
    return content;
}

function cleanMarkdown(value) {
    const normalized = String(value || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return protectTechnicalHtml(convertLabeledCodeBlocks(normalized))
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function repairKnownDocumentIssues(value) {
    return String(value || '').replace(
        /(<h1[^>]*>(?:(?!<\/h1>)[\s\S])*?Ngày\s+2(?:(?!<\/h1>)[\s\S])*?<\/h1>)(?!\s*<h2)/i,
        '$1<h2>Bài Lab: Remote code execution via web shell upload</h2>'
    );
}

function collectDocumentSections(html) {
    const headingPattern = /<h([12])[^>]*>([\s\S]*?)<\/h\1>/gi;
    const headings = [];
    let match;

    while ((match = headingPattern.exec(html)) !== null) {
        headings.push({
            level: Number(match[1]),
            rawTitle: match[2],
            title: decodeHtmlText(match[2]),
            start: match.index,
            end: headingPattern.lastIndex
        });
    }

    const firstChapter = headings.find((heading) => (
        heading.level === 1 &&
        (/CHƯƠNG\s+1\b/i.test(heading.title) || /Ngày\s+1\b/i.test(heading.title))
    ));
    if (!firstChapter) {
        const detected = headings
            .slice(0, 12)
            .map((heading) => `h${heading.level}:${heading.title}`)
            .join(' | ');
        throw new Error(
            `Không tìm thấy CHƯƠNG 1 trong tài liệu Word. Heading nhận được: ${detected || '(không có)'}`
        );
    }

    const labHeadings = headings.filter((heading) => (
        heading.level === 2 && /^Bài\s+Lab/i.test(heading.title)
    ));
    if (labHeadings.length === 0) {
        throw new Error('Không tìm thấy heading bài lab trong tài liệu Word.');
    }

    const removeChapterHeadings = (fragment) => fragment
        .replace(/<h1[^>]*>[\s\S]*?<\/h1>/gi, '');

    const setupHtml = removeChapterHeadings(
        html.slice(firstChapter.end, labHeadings[0].start)
    );
    const labs = labHeadings.map((heading, index) => ({
        title: normalizeLabTitle(heading.rawTitle),
        html: removeChapterHeadings(
            html.slice(
                heading.end,
                labHeadings[index + 1]?.start ?? html.length
            )
        )
    }));

    return { setupHtml, labs };
}

function usedImageIds(content, images) {
    return images
        .filter((image) => content.includes(image.placeholder))
        .map((image) => image.id);
}

async function convertDocxWriteup(docxPath) {
    const resolvedPath = path.resolve(docxPath);
    const stats = await fs.promises.stat(resolvedPath);
    if (!stats.isFile() || path.extname(resolvedPath).toLowerCase() !== '.docx') {
        throw new Error('Đường dẫn phải trỏ tới một file .docx.');
    }

    const images = [];
    const convertImage = mammoth.images.imgElement(async (image) => {
        const extension = IMAGE_EXTENSIONS.get(image.contentType);
        if (!extension) {
            throw new Error(`Ảnh ${image.contentType} trong DOCX chưa được hỗ trợ.`);
        }
        const id = images.length + 1;
        const placeholder = `DOCX_IMAGE_${String(id).padStart(3, '0')}`;
        images.push({
            id,
            placeholder,
            extension,
            contentType: image.contentType,
            buffer: await image.readAsBuffer()
        });
        return {
            src: placeholder,
            alt: `Ảnh minh họa ${id}`
        };
    });

    const result = await mammoth.convertToHtml(
        { path: resolvedPath },
        {
            convertImage,
            includeDefaultStyleMap: true,
            styleMap: STYLE_MAP
        }
    );

    const repairedHtml = repairKnownDocumentIssues(result.value);
    const { setupHtml, labs } = collectDocumentSections(repairedHtml);
    const turndown = createTurndownService();
    const setupContent = cleanMarkdown(turndown.turndown(setupHtml));
    const pages = labs.map((lab) => {
        const category = categoryForTitle(lab.title);
        const markdown = cleanMarkdown(turndown.turndown(lab.html));
        return {
            title: lab.title,
            slug: slugify(lab.title),
            categorySlug: category.slug,
            tags: cleanTags(category.tags),
            content: `${SCOPE_NOTE}\n\n${markdown}`.trim()
        };
    });
    if (setupContent) {
        pages.unshift({
            title: 'Setup HTTP và Burp Suite',
            slug: 'setup-http-burp-suite',
            categorySlug: null,
            tags: ['portswigger', 'burp-suite', 'http', 'lab'],
            content: `${SCOPE_NOTE}\n\n${setupContent}`.trim()
        });
    }

    for (const page of pages) {
        page.imageIds = usedImageIds(page.content, images);
    }

    const usedCategorySlugs = new Set(
        pages.map((page) => page.categorySlug).filter(Boolean)
    );
    return {
        sourcePath: resolvedPath,
        messages: result.messages,
        categories: CATEGORY_DEFINITIONS
            .filter((category) => usedCategorySlugs.has(category.slug))
            .map(({ title, slug, tags }) => ({ title, slug, tags })),
        pages,
        images,
        unusedImageIds: images
            .filter((image) => !pages.some((page) => page.imageIds.includes(image.id)))
            .map((image) => image.id)
    };
}

module.exports = {
    CATEGORY_DEFINITIONS,
    SCOPE_NOTE,
    categoryForTitle,
    cleanMarkdown,
    collectDocumentSections,
    convertDocxWriteup,
    decodeHtmlText,
    normalizeLabTitle,
    repairKnownDocumentIssues
};
