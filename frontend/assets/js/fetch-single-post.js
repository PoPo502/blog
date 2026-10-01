document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("post-container");
  const slug = new URLSearchParams(window.location.search).get("slug");

  if (!slug || !container) {
    showError("Không tìm thấy bài viết.");
    return;
  }

  try {
    const migratedResponse = await fetch(
      `/api/nodes/legacy-by-slug?slug=${encodeURIComponent(slug)}`,
      { headers: { Accept: "application/json" } }
    );
    if (migratedResponse.ok) {
      const migrated = await migratedResponse.json();
      window.location.replace(migrated.path);
      return;
    }
  } catch (error) {
    console.warn("Could not check migrated URL:", error);
  }

  function showError(message) {
    const error = document.createElement("p");
    error.className = "state-message";
    error.textContent = message;
    container?.replaceChildren(error);
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(new Date(value));
  }

  function safeImageUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(value, window.location.origin);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function makeHeadingId(text, index) {
    const normalized = text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return normalized || `section-${index + 1}`;
  }

  function enhanceCodeBlocks(contentElement) {
    contentElement.querySelectorAll("pre code").forEach((code) => {
      window.hljs?.highlightElement(code);

      const pre = code.closest("pre");
      if (!pre || pre.parentElement?.classList.contains("code-block")) return;

      const wrapper = document.createElement("div");
      wrapper.className = "code-block";
      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);

      const button = document.createElement("button");
      button.className = "copy-code";
      button.type = "button";
      button.textContent = "Copy";
      button.addEventListener("click", async () => {
        await navigator.clipboard.writeText(code.textContent);
        button.textContent = "Copied";
        window.setTimeout(() => {
          button.textContent = "Copy";
        }, 1500);
      });
      wrapper.appendChild(button);
    });
  }

  function enhanceDownloads(contentElement) {
    contentElement.querySelectorAll('a[href^="/api/upload/files/"]').forEach((link) => {
      link.classList.add("download-card");
      link.setAttribute("download", "");
    });
  }

  function buildTableOfContents(contentElement) {
    const headings = [...contentElement.querySelectorAll("h2, h3")];
    if (headings.length < 2) return null;

    const usedIds = new Set();
    const toc = document.createElement("nav");
    toc.className = "table-of-contents";
    toc.setAttribute("aria-label", "Mục lục bài viết");

    const label = document.createElement("strong");
    label.textContent = "Mục lục";
    const list = document.createElement("ul");

    headings.forEach((heading, index) => {
      let id = makeHeadingId(heading.textContent, index);
      while (usedIds.has(id)) id = `${id}-${index + 1}`;
      usedIds.add(id);
      heading.id = id;

      const item = document.createElement("li");
      if (heading.tagName === "H3") item.className = "toc-level-3";
      const link = document.createElement("a");
      link.href = `#${id}`;
      link.textContent = heading.textContent;
      item.appendChild(link);
      list.appendChild(item);
    });

    toc.append(label, list);
    return toc;
  }

  function renderPost(post) {
    document.title = `${post.title} | Phạm Đức Quân`;

    const header = document.createElement("header");
    header.className = "post-header";

    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "Security note";

    const title = document.createElement("h1");
    title.className = "post-title";
    title.textContent = post.title;

    const meta = document.createElement("div");
    meta.className = "post-meta";
    for (const value of [
      formatDate(post.createdAt),
      post.author || "Admin",
      `${post.views || 0} lượt xem`
    ]) {
      const item = document.createElement("span");
      item.textContent = value;
      meta.appendChild(item);
    }

    const tags = document.createElement("div");
    tags.className = "tag-list";
    for (const tagName of post.tags || []) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = `#${tagName}`;
      tags.appendChild(tag);
    }

    header.append(eyebrow, title, meta, tags);

    const coverUrl = safeImageUrl(post.coverImage);
    if (coverUrl) {
      const cover = document.createElement("img");
      cover.className = "post-cover";
      cover.src = coverUrl;
      cover.alt = post.title;
      cover.decoding = "async";
      header.appendChild(cover);
    }

    const content = document.createElement("article");
    content.className = "post-content";

    content.innerHTML = window.MarkdownRenderer.render(post.content);

    enhanceCodeBlocks(content);
    enhanceDownloads(content);

    const toc = buildTableOfContents(content);
    container.replaceChildren(header);
    if (toc) container.appendChild(toc);
    container.appendChild(content);
  }

  try {
    const response = await fetch(`/api/posts/${encodeURIComponent(slug)}`, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error("Post not found");
    renderPost(await response.json());
  } catch (error) {
    console.error("Error fetching post:", error);
    showError("Không thể tải bài viết. Bài viết có thể không tồn tại.");
  }
});
