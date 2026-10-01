(function createMarkdownRenderer(global) {
  "use strict";

  const allowedTags = [
    "a", "blockquote", "br", "code", "del", "div", "em", "h1", "h2",
    "h3", "h4", "h5", "h6", "hr", "img", "kbd", "li", "ol", "p",
    "pre", "s", "samp", "span", "strong", "sub", "sup", "table",
    "tbody", "td", "th", "thead", "tr", "ul"
  ];
  const allowedAttributes = [
    "alt", "class", "colspan", "decoding", "download", "height", "href",
    "loading", "rel", "rowspan", "scope", "src", "title", "width"
  ];

  function render(markdown) {
    if (!global.marked || !global.DOMPurify) return "";
    const parsed = global.marked.parse(String(markdown || ""), {
      gfm: true,
      breaks: false
    });
    return global.DOMPurify.sanitize(parsed, {
      ALLOWED_TAGS: allowedTags,
      ALLOWED_ATTR: allowedAttributes,
      ALLOW_ARIA_ATTR: false,
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: [
        "audio", "button", "canvas", "embed", "form", "iframe", "input",
        "math", "object", "script", "style", "svg", "template", "textarea", "video"
      ],
      FORBID_ATTR: ["style"],
      SANITIZE_NAMED_PROPS: true
    });
  }

  global.MarkdownRenderer = Object.freeze({ render });
})(window);
