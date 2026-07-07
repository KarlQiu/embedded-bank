(function () {
  "use strict";

  const DATA = window.EMBEDDED_BANK_DATA;
  const CONFIG = {
    passwordHash: "a56c917efe91f70c89d56203569bb932d5e488da43ef69caff62f8605c882dff",
    storagePrefix: "embeddedBank.",
  };

  const keys = {
    auth: CONFIG.storagePrefix + "auth",
    progress: CONFIG.storagePrefix + "progress",
    theme: CONFIG.storagePrefix + "theme",
    bookmarks: CONFIG.storagePrefix + "bookmarks",
    mastered: CONFIG.storagePrefix + "mastered",
  };

  const state = {
    currentDoc: null,
    currentQuestion: null,
    flat: [],
    bookmarks: new Set(readJson(keys.bookmarks, [])),
    mastered: readJson(keys.mastered, {}),
    theme: readJson(keys.theme, { name: "light", fontSize: 17, lineHeight: 1.72 }),
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    bindElements();
    applyTheme();
    buildFlatIndex();
    bindAuth();
    if (isAuthed()) {
      showApp();
    } else {
      showAuth();
    }
  }

  function bindElements() {
    [
      "auth-view",
      "auth-form",
      "password-input",
      "auth-error",
      "app-view",
      "question-count",
      "outline",
      "content",
      "search-input",
      "search-results",
      "menu-toggle",
      "sidebar",
      "sidebar-close",
      "scrim",
      "settings-toggle",
      "settings-panel",
      "settings-close",
      "font-size",
      "line-height",
      "continue-button",
      "bookmark-button",
      "master-button",
      "review-button",
      "prev-button",
      "next-button",
      "logout-button",
    ].forEach((id) => {
      els[toCamel(id)] = document.getElementById(id);
    });
  }

  function bindAuth() {
    els.authForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = els.passwordInput.value.trim();
      const hash = await sha256(password);
      if (hash === CONFIG.passwordHash) {
        localStorage.setItem(keys.auth, "ok:" + CONFIG.passwordHash);
        els.passwordInput.value = "";
        els.authError.hidden = true;
        showApp();
      } else {
        els.authError.hidden = false;
      }
    });
  }

  function showAuth() {
    els.authView.hidden = false;
    els.appView.hidden = true;
  }

  function showApp() {
    els.authView.hidden = true;
    els.appView.hidden = false;
    renderOutline();
    bindAppEvents();
    els.questionCount.textContent = `${DATA.meta.questionCount} 道题 · ${DATA.docs.length} 个文件`;
    const progress = readJson(keys.progress, null);
    els.continueButton.hidden = !progress;
    routeFromHash();
    if (!location.hash) {
      if (progress && progress.route) {
        navigate(progress.route, { restoreScroll: true });
      } else {
        const first = state.flat[0];
        navigate(first ? routeFor(first.docSlug, first.id) : `#/doc/${DATA.docs[0].slug}`);
      }
    }
    window.addEventListener("hashchange", routeFromHash);
    window.addEventListener("scroll", throttle(saveProgress, 700), { passive: true });
    registerServiceWorker();
  }

  function bindAppEvents() {
    if (els.appView.dataset.bound) return;
    els.appView.dataset.bound = "1";

    els.searchInput.addEventListener("input", debounce(handleSearch, 150));
    els.menuToggle.addEventListener("click", openSidebar);
    els.sidebarClose.addEventListener("click", closeSidebar);
    els.scrim.addEventListener("click", closePanels);
    els.settingsToggle.addEventListener("click", () => {
      els.settingsPanel.hidden = !els.settingsPanel.hidden;
    });
    els.settingsClose.addEventListener("click", () => {
      els.settingsPanel.hidden = true;
    });
    els.continueButton.addEventListener("click", () => {
      const progress = readJson(keys.progress, null);
      if (progress && progress.route) navigate(progress.route, { restoreScroll: true });
    });
    els.fontSize.value = state.theme.fontSize;
    els.lineHeight.value = state.theme.lineHeight;
    els.fontSize.addEventListener("input", () => updateTheme({ fontSize: Number(els.fontSize.value) }));
    els.lineHeight.addEventListener("input", () => updateTheme({ lineHeight: Number(els.lineHeight.value) }));
    document.querySelectorAll("[data-theme]").forEach((button) => {
      button.addEventListener("click", () => updateTheme({ name: button.dataset.theme }));
    });
    els.bookmarkButton.addEventListener("click", toggleBookmark);
    els.masterButton.addEventListener("click", () => setMastery("mastered"));
    els.reviewButton.addEventListener("click", () => setMastery("review"));
    els.prevButton.addEventListener("click", () => goAdjacent(-1));
    els.nextButton.addEventListener("click", () => goAdjacent(1));
    els.logoutButton.addEventListener("click", () => {
      localStorage.removeItem(keys.auth);
      location.reload();
    });
  }

  function buildFlatIndex() {
    DATA.docs.forEach((doc) => {
      doc.questions.forEach((question, index) => {
        state.flat.push({
          ...question,
          index,
          docSlug: doc.slug,
          docTitle: doc.title,
          itemKey: itemKey(doc.slug, question.id),
        });
      });
    });
  }

  function renderOutline() {
    els.outline.innerHTML = "";
    DATA.docs.forEach((doc) => {
      const group = document.createElement("section");
      group.className = "doc-group";
      const docButton = document.createElement("button");
      docButton.className = "doc-button";
      docButton.type = "button";
      docButton.innerHTML = `<span>${escapeHtml(doc.shortTitle || doc.title)}</span><small>${doc.questions.length || "文档"}</small>`;
      docButton.addEventListener("click", () => navigate(`#/doc/${doc.slug}`));
      group.appendChild(docButton);

      if (doc.questions.length) {
        const list = document.createElement("div");
        list.className = "section-list";
        let lastSection = "";
        doc.questions.forEach((question) => {
          if (question.section && question.section !== lastSection) {
            lastSection = question.section;
            const title = document.createElement("div");
            title.className = "section-title";
            title.textContent = lastSection;
            list.appendChild(title);
          }
          const link = document.createElement("button");
          link.className = "question-link";
          link.type = "button";
          link.dataset.route = routeFor(doc.slug, question.id);
          link.textContent = `${question.id}: ${question.title}`;
          link.addEventListener("click", () => navigate(link.dataset.route));
          list.appendChild(link);
        });
        group.appendChild(list);
      }

      els.outline.appendChild(group);
    });
  }

  function routeFromHash(options = {}) {
    const hash = location.hash || "";
    const match = hash.match(/^#\/doc\/([^/]+)(?:\/q\/([^/]+))?/);
    if (!match) return;
    const doc = DATA.docs.find((item) => item.slug === decodeURIComponent(match[1])) || DATA.docs[0];
    const questionId = match[2] ? decodeURIComponent(match[2]) : null;
    const question = questionId ? doc.questions.find((item) => item.id === questionId) : null;
    state.currentDoc = doc;
    state.currentQuestion = question || null;
    renderContent(doc, question);
    markActiveLink();
    closeSidebar();
    saveProgress();
    if (options.restoreScroll) restoreScroll();
  }

  function renderContent(doc, question) {
    const key = question ? itemKey(doc.slug, question.id) : null;
    if (question) {
      els.content.innerHTML = `
        <header class="content-header">
          <div class="crumbs">${escapeHtml(doc.title)} / ${escapeHtml(question.section || "题目")}</div>
          <h1>${escapeHtml(question.id)}: ${escapeHtml(question.title)}</h1>
          <div class="reader-actions">
            <button type="button" data-action="bookmark"></button>
            <button type="button" data-action="mastered"></button>
            <button type="button" data-action="review"></button>
          </div>
        </header>
        ${question.html}
      `;
      els.content.querySelector('[data-action="bookmark"]').addEventListener("click", toggleBookmark);
      els.content.querySelector('[data-action="mastered"]').addEventListener("click", () => setMastery("mastered"));
      els.content.querySelector('[data-action="review"]').addEventListener("click", () => setMastery("review"));
    } else {
      els.content.innerHTML = `
        <header class="content-header">
          <div class="crumbs">文档</div>
          <h1>${escapeHtml(doc.title)}</h1>
        </header>
        ${doc.html || "<p>这个文档没有可展示内容。</p>"}
      `;
    }
    enhanceContent();
    updateActionState(key);
    window.scrollTo({ top: 0 });
  }

  function enhanceContent() {
    els.content.querySelectorAll("pre").forEach((pre) => {
      if (pre.parentElement.classList.contains("pre-wrap")) return;
      const wrap = document.createElement("div");
      wrap.className = "pre-wrap";
      const button = document.createElement("button");
      button.className = "copy-code";
      button.type = "button";
      button.textContent = "复制";
      button.addEventListener("click", async () => {
        await navigator.clipboard.writeText(pre.innerText);
        button.textContent = "已复制";
        setTimeout(() => (button.textContent = "复制"), 1200);
      });
      pre.before(wrap);
      wrap.appendChild(pre);
      wrap.appendChild(button);
    });

    els.content.querySelectorAll("table").forEach((table) => {
      if (table.parentElement.classList.contains("table-wrap")) return;
      const wrap = document.createElement("div");
      wrap.className = "table-wrap";
      table.before(wrap);
      wrap.appendChild(table);
    });
  }

  function handleSearch() {
    const query = els.searchInput.value.trim().toLowerCase();
    if (!query) {
      els.searchResults.hidden = true;
      els.searchResults.innerHTML = "";
      return;
    }
    const terms = query.split(/\s+/).filter(Boolean);
    const hits = state.flat
      .map((item) => {
        const hayTitle = `${item.id} ${item.title}`.toLowerCase();
        const hayText = item.search.toLowerCase();
        const titleScore = terms.every((term) => hayTitle.includes(term)) ? 20 : 0;
        const textScore = terms.every((term) => hayText.includes(term)) ? 5 : 0;
        return { item, score: titleScore + textScore };
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 60);

    els.searchResults.hidden = false;
    els.searchResults.innerHTML = `<div class="search-summary">找到 ${hits.length} 条结果</div>`;
    hits.forEach(({ item }) => {
      const button = document.createElement("button");
      button.className = "search-hit";
      button.type = "button";
      button.innerHTML = `<strong>${escapeHtml(item.id)}: ${escapeHtml(item.title)}</strong><small>${escapeHtml(item.docTitle)} / ${escapeHtml(item.section || "")}</small>`;
      button.addEventListener("click", () => {
        els.searchInput.value = "";
        els.searchResults.hidden = true;
        navigate(routeFor(item.docSlug, item.id));
      });
      els.searchResults.appendChild(button);
    });
  }

  function toggleBookmark() {
    if (!state.currentQuestion) return;
    const key = itemKey(state.currentDoc.slug, state.currentQuestion.id);
    if (state.bookmarks.has(key)) state.bookmarks.delete(key);
    else state.bookmarks.add(key);
    localStorage.setItem(keys.bookmarks, JSON.stringify([...state.bookmarks]));
    updateActionState(key);
  }

  function setMastery(value) {
    if (!state.currentQuestion) return;
    const key = itemKey(state.currentDoc.slug, state.currentQuestion.id);
    state.mastered[key] = state.mastered[key] === value ? "" : value;
    if (!state.mastered[key]) delete state.mastered[key];
    localStorage.setItem(keys.mastered, JSON.stringify(state.mastered));
    updateActionState(key);
  }

  function updateActionState(key) {
    const hasQuestion = Boolean(key);
    [els.bookmarkButton, els.masterButton, els.reviewButton, els.prevButton, els.nextButton].forEach((button) => {
      button.disabled = !hasQuestion;
    });
    if (!hasQuestion) return;
    const bookmarked = state.bookmarks.has(key);
    const mastery = state.mastered[key];
    setButtonActive(els.bookmarkButton, bookmarked, bookmarked ? "已收藏" : "收藏");
    setButtonActive(els.masterButton, mastery === "mastered", "掌握");
    setButtonActive(els.reviewButton, mastery === "review", "待复习");
    els.content.querySelectorAll("[data-action]").forEach((button) => {
      const action = button.dataset.action;
      if (action === "bookmark") setButtonActive(button, bookmarked, bookmarked ? "已收藏" : "收藏");
      if (action === "mastered") setButtonActive(button, mastery === "mastered", "掌握");
      if (action === "review") setButtonActive(button, mastery === "review", "待复习");
    });
  }

  function goAdjacent(direction) {
    if (!state.currentQuestion) return;
    const currentKey = itemKey(state.currentDoc.slug, state.currentQuestion.id);
    const index = state.flat.findIndex((item) => item.itemKey === currentKey);
    const target = state.flat[index + direction];
    if (target) navigate(routeFor(target.docSlug, target.id));
  }

  function navigate(route, options = {}) {
    if (location.hash === route) {
      routeFromHash(options);
    } else {
      location.hash = route;
      if (options.restoreScroll) setTimeout(restoreScroll, 80);
    }
  }

  function routeFor(docSlug, questionId) {
    return `#/doc/${encodeURIComponent(docSlug)}/q/${encodeURIComponent(questionId)}`;
  }

  function saveProgress() {
    if (!state.currentDoc) return;
    localStorage.setItem(
      keys.progress,
      JSON.stringify({
        route: location.hash,
        docSlug: state.currentDoc.slug,
        questionId: state.currentQuestion ? state.currentQuestion.id : null,
        scrollY: window.scrollY,
        savedAt: Date.now(),
      })
    );
    els.continueButton.hidden = false;
  }

  function restoreScroll() {
    const progress = readJson(keys.progress, null);
    if (progress && typeof progress.scrollY === "number") {
      setTimeout(() => window.scrollTo({ top: progress.scrollY }), 60);
    }
  }

  function updateTheme(patch) {
    state.theme = { ...state.theme, ...patch };
    localStorage.setItem(keys.theme, JSON.stringify(state.theme));
    applyTheme();
  }

  function applyTheme() {
    document.body.dataset.theme = state.theme.name || "light";
    document.documentElement.style.setProperty("--font-size", `${state.theme.fontSize || 17}px`);
    document.documentElement.style.setProperty("--line-height", state.theme.lineHeight || 1.72);
  }

  function markActiveLink() {
    const route = location.hash;
    document.querySelectorAll(".question-link").forEach((link) => {
      link.classList.toggle("active", link.dataset.route === route);
    });
  }

  function setButtonActive(button, active, text) {
    button.classList.toggle("active", active);
    button.textContent = text;
  }

  function itemKey(docSlug, questionId) {
    return `${docSlug}:${questionId}`;
  }

  function isAuthed() {
    return localStorage.getItem(keys.auth) === "ok:" + CONFIG.passwordHash;
  }

  async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function readJson(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function debounce(fn, delay) {
    let timer = 0;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function throttle(fn, delay) {
    let last = 0;
    let timer = 0;
    return (...args) => {
      const now = Date.now();
      if (now - last >= delay) {
        last = now;
        fn(...args);
      } else {
        clearTimeout(timer);
        timer = setTimeout(() => {
          last = Date.now();
          fn(...args);
        }, delay - (now - last));
      }
    };
  }

  function openSidebar() {
    els.sidebar.classList.add("open");
    els.scrim.hidden = false;
  }

  function closeSidebar() {
    els.sidebar.classList.remove("open");
    els.scrim.hidden = true;
  }

  function closePanels() {
    closeSidebar();
    els.settingsPanel.hidden = true;
  }

  function toCamel(id) {
    return id.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }
})();
