(function () {
  "use strict";

  const THEME_KEY = "pq_blog_theme";
  const LANG_KEY = "pq_blog_lang";

  const translations = {
    vi: {
      nav_home: "Trang chủ",
      nav_blog: "Blog",
      nav_about: "About",
      theme_dark: "Chế độ tối",
      theme_light: "Chế độ sáng",
      hero_title_hello: "Xin chào, mình là",
      hero_desc_1: "Mình là Quân, sinh viên Học viện Công nghệ Bưu chính Viễn thông (PTIT), có định hướng theo lĩnh vực An toàn thông tin.",
      hero_desc_2: "Không gian này là nơi mình tổng hợp những ghi chép trong quá trình học tập và thực hành: các bài lab, kỹ thuật, đoạn lệnh minh họa, write-up và tài liệu tham khảo. Mình chia sẻ với mong muốn lưu giữ quá trình phát triển của bản thân, đồng thời kết nối với những người cùng đam mê để trao đổi kiến thức, nhận góp ý và học hỏi thêm từ cộng đồng.",
      about_eyebrow: "About me",
      about_title: "Phạm Đức Quân",
      about_subtitle: "Just a blog about information security.",
      about_p1: "Xin chào! Mình là Quân. Đây là blog cá nhân mình tạo ra để lưu lại và chia sẻ kiến thức về an toàn thông tin, các bài lab thực hành và tài liệu hữu ích.",
      about_p2: "Mình tin rằng cách học tốt nhất là tự tay thực hành, ghi chép lại từng bước và chia sẻ với những người có cùng sở thích. Hy vọng các bài viết ở đây có thể giúp bạn hiểu rõ hơn một kỹ thuật hoặc tiết kiệm thời gian khi làm lab.",
      about_p3: "Bạn có thể tìm thấy mình tại các nền tảng bên dưới.",
      blog_sidebar_eyebrow: "Blog an toàn thông tin",
      blog_sidebar_title: "Nội dung",
      blog_eyebrow: "Bài viết an toàn thông tin",
      views: "lượt xem",
      likes: "lượt thích",
      like: "Thích",
      liked: "Đã thích",
      like_aria: "Thích page này",
      unlike_aria: "Bỏ thích page này",
      toc: "Mục lục",
      attachments: "Tệp đính kèm",
      empty_tree: "Chưa có nội dung công khai.",
      empty_folder: "Chưa có nội dung bên trong.",
      copy: "Copy",
      copied: "Đã chép",
      created: "Tạo",
      updated: "Cập nhật",
      security_page: "Security page"
    },
    en: {
      nav_home: "Home",
      nav_blog: "Blog",
      nav_about: "About",
      theme_dark: "Dark Mode",
      theme_light: "Light Mode",
      hero_title_hello: "Hello, I am",
      hero_desc_1: "I'm Quân, a student at Posts and Telecommunications Institute of Technology (PTIT), pursuing Information Security.",
      hero_desc_2: "This space is where I compile notes from my studies and hands-on practice: labs, techniques, command cheatsheets, write-ups, and reference materials. I share them to track my own growth, while connecting with fellow security enthusiasts to exchange insights and learn from the community.",
      about_eyebrow: "About me",
      about_title: "Phạm Đức Quân",
      about_subtitle: "Just a blog about information security.",
      about_p1: "Hello! I'm Quân. This is my personal blog where I document and share knowledge about cybersecurity, hands-on labs, and helpful technical guides.",
      about_p2: "I believe the best way to learn is by doing, taking step-by-step notes, and sharing with peers. I hope the articles here help you master concepts or save time during labs.",
      about_p3: "You can connect with me on the platforms below.",
      blog_sidebar_eyebrow: "Security Blog",
      blog_sidebar_title: "Contents",
      blog_eyebrow: "Security Articles & Labs",
      views: "views",
      likes: "likes",
      like: "Like",
      liked: "Liked",
      like_aria: "Like this page",
      unlike_aria: "Unlike this page",
      toc: "Table of Contents",
      attachments: "Attachments",
      empty_tree: "No public content yet.",
      empty_folder: "No items inside.",
      copy: "Copy",
      copied: "Copied",
      created: "Created",
      updated: "Updated",
      security_page: "Security page"
    }
  };

  function getSavedTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch (_) {}
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
      return "light";
    }
    return "dark";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (_) {}

    const btn = document.getElementById("theme-toggle-btn");
    if (btn) {
      const isLight = theme === "light";
      btn.innerHTML = isLight ? '<span class="theme-icon">☀️</span>' : '<span class="theme-icon">🌙</span>';
      btn.setAttribute("aria-label", isLight ? "Chuyển sang chế độ tối" : "Chuyển sang chế độ sáng");
      btn.title = isLight ? "Chuyển sang chế độ tối" : "Chuyển sang chế độ sáng";
    }
  }

  function getSavedLang() {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === "en" || saved === "vi") return saved;
    } catch (_) {}
    return "vi";
  }

  function applyLanguage(lang) {
    document.documentElement.setAttribute("lang", lang);
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch (_) {}

    const dict = translations[lang] || translations.vi;

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (dict[key]) {
        el.textContent = dict[key];
      }
    });

    const langBtn = document.getElementById("lang-toggle-btn");
    if (langBtn) {
      langBtn.innerHTML = lang === "vi"
        ? '<span class="lang-icon">🌐</span><span class="lang-label">EN</span>'
        : '<span class="lang-icon">🌐</span><span class="lang-label">VI</span>';
      langBtn.title = lang === "vi" ? "Switch to English" : "Chuyển sang Tiếng Việt";
      langBtn.setAttribute("aria-label", lang === "vi" ? "Switch to English" : "Chuyển sang Tiếng Việt");
    }

    window.dispatchEvent(new CustomEvent("pq:languagechange", { detail: { lang, dict } }));
  }

  // Immediately apply saved theme to avoid FOUC
  const currentTheme = getSavedTheme();
  document.documentElement.setAttribute("data-theme", currentTheme);

  // Setup DOM controls when ready
  document.addEventListener("DOMContentLoaded", () => {
    applyTheme(currentTheme);
    const currentLang = getSavedLang();
    applyLanguage(currentLang);

    const themeBtn = document.getElementById("theme-toggle-btn");
    if (themeBtn) {
      themeBtn.addEventListener("click", () => {
        const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
        applyTheme(next);
      });
    }

    const langBtn = document.getElementById("lang-toggle-btn");
    if (langBtn) {
      langBtn.addEventListener("click", () => {
        const next = (document.documentElement.getAttribute("lang") || "vi") === "vi" ? "en" : "vi";
        applyLanguage(next);
      });
    }
  });

  window.PQ_I18N = {
    getLang: () => document.documentElement.getAttribute("lang") || "vi",
    t: (key, fallback = "") => {
      const lang = document.documentElement.getAttribute("lang") || "vi";
      const dict = translations[lang] || translations.vi;
      return dict[key] || fallback;
    },
    setLang: applyLanguage,
    setTheme: applyTheme
  };
})();
