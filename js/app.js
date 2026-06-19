/* ==========================================================================
 * iPurple.team Navigator — application logic
 * Pure vanilla JS, no dependencies, no build step. GitHub Pages friendly.
 * ========================================================================== */
(() => {
  "use strict";

  const CONFIG = window.IPURPLE_CONFIG;
  const STORAGE_KEY = CONFIG.layer.storageKey;

  // Edit mode is enabled ONLY when running locally (localhost / file://). On the
  // published site the Navigator is read-only: visitors see the committed
  // coverage (data/coverage.json) but cannot change status, colors, or add
  // techniques. Set CONFIG.editable = true/false to force a mode.
  const EDIT = (() => {
    if (typeof CONFIG.editable === "boolean") return CONFIG.editable;
    const h = location.hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "" ||
           location.protocol === "file:";
  })();
  // mutating-menu actions hidden from visitors
  const EDIT_ACTIONS = new Set(
    ["addTechnique", "import", "export", "clear", "selectAll", "deselectAll"]);

  // small link/chain glyph used on cells and buttons
  const LINK_ICON =
    `<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7h-4a5 5 0 0 0 0 10h4v-1.9h-4A3.1 3.1 0 0 1 3.9 12zm5.1 1h6v-2H9v2zm5-6h-4v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10z"/></svg>`;

  // make a user-entered article URL safe + absolute for use in an href
  function normalizeUrl(u) {
    u = (u || "").trim();
    if (!u || /^javascript:/i.test(u)) return "";
    return /^https?:\/\//i.test(u) ? u : "https://" + u;
  }
  const CUSTOM_KEY = STORAGE_KEY + "-custom";
  const PALETTE_KEY = STORAGE_KEY + "-palette";

  /* ---- runtime state --------------------------------------------------- */
  const state = {
    data: null,                 // loaded dataset (base + custom composed)
    baseTechniques: [],         // techniques from data/attack-windows.json
    custom: [],                 // user-added techniques/sub-techniques
    techById: new Map(),        // id -> technique
    childrenOf: new Map(),      // parentId -> [subtech]
    layer: {                    // user's layer (scores, notes, selection)
      name: CONFIG.layer.name,
      description: CONFIG.layer.description,
      techniques: {},           // id -> { score, note, enabled }
    },
    search: "",
    activeTechId: null,
    editingCustomId: null,      // id being edited in the form (null = new)
    palette: null,              // active heatmap palette key
  };

  /* ====================================================================== *
   *  THEME
   * ====================================================================== */
  function applyTheme() {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(CONFIG.theme || {})) {
      root.style.setProperty(k, v);
    }
    // expose the "partial" color to CSS (segmented control) so it matches cells
    if (CONFIG.heatmap && CONFIG.heatmap.partial) {
      root.style.setProperty("--partial", CONFIG.heatmap.partial);
    }
  }

  /* ====================================================================== *
   *  HEATMAP COLOR
   * ====================================================================== */
  function hexToRgb(hex) {
    const h = hex.replace("#", "");
    const n = h.length === 3
      ? h.split("").map((c) => c + c).join("")
      : h;
    return {
      r: parseInt(n.slice(0, 2), 16),
      g: parseInt(n.slice(2, 4), 16),
      b: parseInt(n.slice(4, 6), 16),
    };
  }
  function rgbToHex({ r, g, b }) {
    const h = (x) => Math.round(x).toString(16).padStart(2, "0");
    return `#${h(r)}${h(g)}${h(b)}`;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ---- palettes --------------------------------------------------------
  function getPalettes() {
    const h = CONFIG.heatmap;
    if (h.palettes && Object.keys(h.palettes).length) return h.palettes;
    // legacy single-gradient config (heatmap.stops)
    return { default: { label: "Default", stops: h.stops || [] } };
  }
  function paletteKeys() { return Object.keys(getPalettes()); }
  function activeStops() {
    const p = getPalettes()[state.palette] || getPalettes()[paletteKeys()[0]];
    return [...(p.stops || [])].sort((a, b) => a.score - b.score);
  }
  function persistPalette() {
    if (!EDIT) return;
    try { localStorage.setItem(PALETTE_KEY, state.palette); } catch (e) { /* ignore */ }
  }
  function restorePalette() {
    try { return localStorage.getItem(PALETTE_KEY); } catch (e) { return null; }
  }
  function setPalette(key) {
    if (!getPalettes()[key]) return;
    state.palette = key;
    persistPalette();
    refreshAllCells();   // recolor every cell with the new gradient
    renderLegend();
    toast(`Heatmap: ${getPalettes()[key].label || key}`);
  }

  function scoreColor(score) {
    if (score === null || score === undefined || score === "") {
      return CONFIG.heatmap.unscored;
    }
    const s = Math.max(0, Math.min(100, Number(score)));
    const stops = activeStops();
    if (s <= stops[0].score) return stops[0].color;
    if (s >= stops[stops.length - 1].score) return stops[stops.length - 1].color;
    for (let i = 0; i < stops.length - 1; i++) {
      const lo = stops[i], hi = stops[i + 1];
      if (s >= lo.score && s <= hi.score) {
        const t = (s - lo.score) / (hi.score - lo.score);
        const c1 = hexToRgb(lo.color), c2 = hexToRgb(hi.color);
        return rgbToHex({
          r: lerp(c1.r, c2.r, t),
          g: lerp(c1.g, c2.g, t),
          b: lerp(c1.b, c2.b, t),
        });
      }
    }
    return CONFIG.heatmap.unscored;
  }

  // luminance check -> dark text on light/bright cells for readability
  // (threshold 0.6 also catches bright mid-tones like orange/amber)
  function isLight(hex) {
    const { r, g, b } = hexToRgb(hex);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6;
  }

  /* ====================================================================== *
   *  BRANDING / CHROME
   * ====================================================================== */
  function renderBrand() {
    const b = CONFIG.brand;
    document.getElementById("brandLogo").textContent = b.logoText;
    const nameEl = document.getElementById("brandName");
    nameEl.innerHTML =
      `${escapeHtml(b.name)} <span class="accent">${escapeHtml(b.productName)}</span>`;
    document.getElementById("brandTagline").textContent = b.tagline;
    document.getElementById("appFooter").innerHTML =
      `${escapeHtml(b.footer)} · <a href="${b.website}" target="_blank" rel="noopener">${escapeHtml(b.website)}</a>`;
    document.title = `${b.name} · ${b.productName}`;
  }

  function renderLegend() {
    const stops = activeStops();
    const grad = stops.map((s) => `${s.color} ${s.score}%`).join(", ");
    const palettes = getPalettes();
    const showSwitcher = EDIT && Object.keys(palettes).length > 1;  // colors fixed for visitors
    const opts = Object.entries(palettes)
      .map(([k, p]) => `<option value="${k}" ${k === state.palette ? "selected" : ""}>${escapeHtml(p.label || k)}</option>`)
      .join("");
    const el = document.getElementById("legend");
    el.innerHTML =
      `${showSwitcher
          ? `<span class="legend-label">Progress</span>
             <select id="paletteSelect" class="palette-select" title="Switch progress-bar palette">${opts}</select>`
          : ``}
       <span class="legend-label">0%</span>
       <span class="legend-bar" style="background:linear-gradient(90deg, ${grad})"></span>
       <span class="legend-label">100%</span>`;
    const sel = el.querySelector("#paletteSelect");
    if (sel) sel.addEventListener("change", (e) => setPalette(e.target.value));
  }

  function renderMenus() {
    const host = document.getElementById("menus");
    host.innerHTML = "";
    (CONFIG.menus || []).forEach((menu, mi) => {
      // drop mutating items for read-only visitors; skip menu if it empties out
      const items = (menu.items || []).filter(
        (item) => EDIT || !(item.action && EDIT_ACTIONS.has(item.action)));
      if (!items.length) return;

      const wrap = document.createElement("div");
      wrap.className = "menu";
      const btn = document.createElement("button");
      btn.className = "menu-btn";
      btn.innerHTML = `${escapeHtml(menu.label)} <span class="caret">▼</span>`;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = wrap.classList.contains("open");
        closeAllMenus();
        if (!open) wrap.classList.add("open");
      });
      const dd = document.createElement("div");
      dd.className = "menu-dropdown";
      items.forEach((item) => {
        const el = document.createElement("div");
        el.className = "menu-item";
        if (item.href) {
          el.innerHTML = `<span>${escapeHtml(item.label)}</span><span class="ext">↗</span>`;
          el.addEventListener("click", () => {
            window.open(item.href, item.external ? "_blank" : "_self");
            closeAllMenus();
          });
        } else {
          el.innerHTML = `<span>${escapeHtml(item.label)}</span>`;
          el.addEventListener("click", () => {
            runAction(item.action);
            closeAllMenus();
          });
        }
        dd.appendChild(el);
      });
      wrap.appendChild(btn);
      wrap.appendChild(dd);
      host.appendChild(wrap);
    });
  }

  function closeAllMenus() {
    document.querySelectorAll(".menu.open").forEach((m) => m.classList.remove("open"));
  }
  document.addEventListener("click", closeAllMenus);

  function renderStatus() {
    const m = state.data.meta;
    const oc = overallCompletion();
    document.getElementById("layerMeta").innerHTML =
      `<strong>${escapeHtml(state.layer.name)}</strong> · ATT&CK v${m.attack_version} · ` +
      `${m.platform} Enterprise · ` +
      `<span class="status-progress">` +
        `<span class="progress status-prog"><span class="progress-fill" style="width:${oc.pct}%;background:${scoreColor(oc.pct)}"></span></span>` +
        `<span style="color:var(--accent)">${oc.pct}% · ${oc.done} done${oc.partial ? ", " + oc.partial + " partial" : ""} of ${oc.total}</span>` +
      `</span>`;
  }

  /* ====================================================================== *
   *  MATRIX RENDER
   * ====================================================================== */
  function indexData() {
    state.techById.clear();
    state.childrenOf.clear();
    for (const t of state.data.techniques) {
      state.techById.set(t.id, t);
      if (t.isSubtechnique && t.parent) {
        if (!state.childrenOf.has(t.parent)) state.childrenOf.set(t.parent, []);
        state.childrenOf.get(t.parent).push(t);
      }
    }
  }

  // Recompose the dataset from base + custom techniques, then re-index.
  function applyCustom() {
    state.data.techniques = state.baseTechniques.concat(state.custom);
    indexData();
  }

  function topLevelTechniques() {
    return state.data.techniques
      .filter((t) => !t.isSubtechnique)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  function pad(n, len) { return String(n).padStart(len, "0"); }

  function nextTechId() {
    let n = 1;
    while (state.techById.has("TX" + pad(n, 4))) n++;
    return "TX" + pad(n, 4);
  }
  function nextSubId(parentId) {
    // custom sub-techniques start at .901 to avoid clashing with real ones
    let n = 901;
    while (state.techById.has(`${parentId}.${pad(n, 3)}`)) n++;
    return `${parentId}.${pad(n, 3)}`;
  }

  function persistCustom() {
    if (!EDIT) return;
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(state.custom)); }
    catch (e) { /* ignore */ }
  }
  function restoreCustom() {
    try {
      const raw = localStorage.getItem(CUSTOM_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) state.custom = arr;
      }
    } catch (e) { /* ignore */ }
  }

  function techsForTactic(shortname) {
    return state.data.techniques.filter(
      (t) => !t.isSubtechnique && t.tactics.includes(shortname)
    ).sort((a, b) => a.name.localeCompare(b.name));
  }

  function renderMatrix() {
    const host = document.getElementById("matrix");
    host.innerHTML = "";
    for (const tactic of state.data.tactics) {
      const techs = techsForTactic(tactic.shortname);
      const col = document.createElement("div");
      col.className = "tactic-col";

      const header = document.createElement("div");
      header.className = "tactic-header";
      header.dataset.tactic = tactic.shortname;
      header.innerHTML =
        `<div class="tactic-name">${escapeHtml(tactic.name)}</div>
         <div class="tactic-count">${techs.length} techniques · <span class="tactic-pct">0%</span></div>
         <div class="progress tactic-progress"><div class="progress-fill"></div></div>`;
      col.appendChild(header);

      for (const tech of techs) {
        col.appendChild(renderTechWrap(tech, tactic.shortname));
      }
      host.appendChild(col);
    }
    refreshAllCells();
  }

  function renderTechWrap(tech, tacticShortname) {
    const wrap = document.createElement("div");
    wrap.className = "tech-wrap";
    wrap.dataset.techWrap = tech.id;

    const children = (state.childrenOf.get(tech.id) || [])
      .filter((c) => c.tactics.includes(tacticShortname))
      .sort((a, b) => a.id.localeCompare(b.id));

    wrap.appendChild(renderTechCell(tech, children.length));

    if (children.length) {
      const list = document.createElement("div");
      list.className = "subtech-list";
      for (const sub of children) {
        list.appendChild(renderTechCell(sub, 0, true));
      }
      wrap.appendChild(list);
    }
    return wrap;
  }

  function renderTechCell(tech, childCount, isSub = false) {
    const cell = document.createElement("div");
    cell.className = "tech" + (isSub ? " subtech" : "") + (tech.custom ? " custom-tech" : "");
    cell.dataset.tech = tech.id;

    const row = document.createElement("div");
    row.className = "tech-row";

    if (tech.custom) {
      const star = document.createElement("span");
      star.className = "custom-star";
      star.textContent = "★";
      star.title = "Custom technique";
      row.appendChild(star);
    }

    if (childCount > 0) {
      const toggle = document.createElement("button");
      toggle.className = "subtech-toggle";
      toggle.textContent = "+";
      toggle.title = `${childCount} sub-techniques`;
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const wrap = cell.closest(".tech-wrap");
        wrap.classList.toggle("expanded");
        toggle.textContent = wrap.classList.contains("expanded") ? "–" : "+";
      });
      row.appendChild(toggle);
    }

    const idEl = document.createElement("span");
    idEl.className = "tech-id";
    idEl.textContent = tech.id;
    row.appendChild(idEl);

    const nameEl = document.createElement("span");
    nameEl.className = "tech-name";
    nameEl.textContent = tech.name;
    row.appendChild(nameEl);

    const badge = document.createElement("span");
    badge.className = "score-badge";
    badge.style.display = "none";
    row.appendChild(badge);

    const linkBadge = document.createElement("span");
    linkBadge.className = "link-badge";
    linkBadge.style.display = "none";
    row.appendChild(linkBadge);

    const note = document.createElement("span");
    note.className = "note-dot";
    note.style.display = "none";
    row.appendChild(note);

    cell.appendChild(row);

    cell.addEventListener("click", (e) => {
      e.stopPropagation();
      openPopover(tech.id, cell);
    });
    return cell;
  }

  function cellState(id) {
    return state.layer.techniques[id] || {};
  }

  // Effective description: a per-technique override wins over the dataset text.
  // For custom techniques the description lives on the technique object itself.
  function effectiveDescription(tech) {
    if (tech.custom) return tech.description || "";
    const ov = cellState(tech.id).desc;
    return ov != null ? ov : (tech.description || "");
  }
  function hasDescOverride(tech) {
    return !tech.custom && cellState(tech.id).desc != null;
  }

  /* ====================================================================== *
   *  COMPLETION MODEL
   *  - each leaf has a status: "none" | "partial" | "done"
   *  - a leaf = a sub-technique, OR a top-level technique with no sub-techniques
   *  - a leaf's value toward progress: done = 1, partial = 0.5, none = 0
   *  - a top-level technique WITH sub-techniques rolls up its subs' values
   *  - tactic / overall progress = sum of leaf values / total leaves
   * ====================================================================== */
  function childCount(id) { return (state.childrenOf.get(id) || []).length; }
  function isLeaf(tech) { return tech.isSubtechnique || childCount(tech.id) === 0; }

  // status of a leaf (also tolerant of legacy {done:true} entries)
  function leafStatus(id) {
    const st = cellState(id);
    if (st.status === "partial") return "partial";
    if (st.status === "done" || st.done === true) return "done";
    return "none";
  }
  function isDone(id) { return leafStatus(id) === "done"; }
  function leafValue(id) {
    const s = leafStatus(id);
    return s === "done" ? 1 : s === "partial" ? 0.5 : 0;
  }

  // completion for one technique cell
  function techCompletion(tech) {
    if (isLeaf(tech)) {
      const status = leafStatus(tech.id);
      const pct = status === "done" ? 100 : status === "partial" ? 50 : 0;
      return { leaf: true, status, pct, done: status === "done", partial: status === "partial",
               completed: status === "done" ? 1 : 0, total: 1 };
    }
    const subs = state.childrenOf.get(tech.id) || [];
    let val = 0, done = 0, partial = 0;
    for (const s of subs) {
      const st = leafStatus(s.id);
      if (st === "done") { val += 1; done++; }
      else if (st === "partial") { val += 0.5; partial++; }
    }
    const total = subs.length;
    return { leaf: false, done, partial, completed: done, total,
             pct: total ? Math.round((val / total) * 100) : 0 };
  }

  // leaves shown within a tactic column (subs counted in the tactic they appear in)
  function tacticLeaves(shortname) {
    const leaves = [];
    for (const t of techsForTactic(shortname)) {
      const subs = (state.childrenOf.get(t.id) || []).filter((c) => c.tactics.includes(shortname));
      if (subs.length) leaves.push(...subs);
      else leaves.push(t);
    }
    return leaves;
  }
  function summarize(leaves) {
    let val = 0, done = 0, partial = 0;
    for (const l of leaves) {
      const s = leafStatus(l.id);
      if (s === "done") { val += 1; done++; }
      else if (s === "partial") { val += 0.5; partial++; }
    }
    return { done, partial, total: leaves.length,
             pct: leaves.length ? Math.round((val / leaves.length) * 100) : 0 };
  }
  function tacticCompletion(shortname) { return summarize(tacticLeaves(shortname)); }

  // every unique leaf across the matrix (each sub counted once)
  function allLeaves() {
    const leaves = [];
    for (const t of state.data.techniques) {
      if (t.isSubtechnique) leaves.push(t);
      else if (childCount(t.id) === 0) leaves.push(t);
    }
    return leaves;
  }
  function overallCompletion() { return summarize(allLeaves()); }

  function setStatus(id, status) {
    if (!EDIT) return;
    const st = { ...(state.layer.techniques[id] || {}) };
    delete st.done;  // drop any legacy flag
    if (status === "partial" || status === "done") st.status = status;
    else delete st.status;
    if (Object.keys(st).length) state.layer.techniques[id] = st;
    else delete state.layer.techniques[id];
    persist();
    refreshCompletion(id);
  }

  // refresh everything affected by a completion change for `id`
  function refreshCompletion(id) {
    const tech = state.techById.get(id);
    refreshCell(id);
    if (tech && tech.isSubtechnique && tech.parent) refreshCell(tech.parent);
    updateTacticHeaders();
    renderStatus();
  }

  function refreshCell(id) {
    // a technique can appear in several tactic columns — keep ALL its cells in
    // sync (e.g. Process Injection T1055 in Defense Evasion & Privilege Escalation)
    const cells = document.querySelectorAll(`.tech[data-tech="${cssEscape(id)}"]`);
    if (!cells.length) return;
    const st = cellState(id);
    const tech = state.techById.get(id);

    // Color a cell only when it has progress. Leaves: green = done,
    // purple = partial, neutral = not started. Parent techniques are tinted by
    // the palette gradient for their rolled-up %.
    const comp = techCompletion(tech);
    let colored, color;
    if (comp.leaf) {
      colored = comp.status !== "none";
      color = comp.status === "done" ? scoreColor(100)
            : comp.status === "partial" ? CONFIG.heatmap.partial
            : CONFIG.heatmap.unscored;
    } else {
      colored = comp.pct > 0;
      color = colored ? scoreColor(comp.pct) : CONFIG.heatmap.unscored;
    }
    const links = Array.isArray(st.links) ? st.links : [];

    cells.forEach((cell) => {
      cell.classList.toggle("deselected", st.enabled === false);
      cell.style.background = color;
      cell.classList.toggle("colored", colored);
      cell.classList.toggle("light-cell", colored && isLight(color));
      cell.classList.toggle("complete", comp.pct === 100);

      // badge: leaves rely on the green fill alone (no check mark);
      // parent techniques show a percentage
      const badge = cell.querySelector(".score-badge");
      badge.classList.remove("done-badge");
      if (!comp.leaf && comp.pct > 0) {
        badge.textContent = `${comp.pct}%`;
        badge.style.display = "";
      } else {
        badge.style.display = "none";
      }

      const lb = cell.querySelector(".link-badge");
      if (links.length) {
        lb.innerHTML = `${LINK_ICON}<span>${links.length}</span>`;
        lb.title = `${links.length} iPurple article${links.length === 1 ? "" : "s"}`;
        lb.style.display = "";
      } else {
        lb.style.display = "none";
      }

      const dot = cell.querySelector(".note-dot");
      dot.style.display = st.note ? "" : "none";
    });
  }

  function refreshAllCells() {
    for (const t of state.data.techniques) refreshCell(t.id);
    updateTacticHeaders();
    renderStatus();
  }

  function updateTacticHeaders() {
    document.querySelectorAll(".tactic-header[data-tactic]").forEach((h) => {
      const comp = tacticCompletion(h.dataset.tactic);
      const fill = h.querySelector(".tactic-progress .progress-fill");
      const pct = h.querySelector(".tactic-pct");
      if (fill) { fill.style.width = comp.pct + "%"; fill.style.background = scoreColor(comp.pct); }
      if (pct) pct.textContent = `${comp.pct}%`;
      h.title = `${comp.pct}% — ${comp.done} done${comp.partial ? ", " + comp.partial + " partial" : ""} of ${comp.total}`;
    });
  }

  /* ====================================================================== *
   *  TECHNIQUE POPOVER (editor)
   * ====================================================================== */
  function positionPopover(pop, anchorEl) {
    const r = anchorEl.getBoundingClientRect();
    const pw = 340, ph = pop.offsetHeight;
    let left = r.right + 10;
    if (left + pw > window.innerWidth - 12) left = Math.max(12, r.left - pw - 10);
    let top = r.top;
    if (top + ph > window.innerHeight - 12) top = Math.max(12, window.innerHeight - ph - 12);
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  }

  // Read-only popover for visitors: status, description, and clickable
  // iPurple article links — no editing controls.
  function openReadonlyPopover(tech, anchorEl) {
    state.activeTechId = tech.id;
    const st = cellState(tech.id);
    const pop = document.getElementById("popover");
    const backdrop = document.getElementById("popoverBackdrop");
    const comp = techCompletion(tech);
    const statusLabel = comp.leaf
      ? (comp.status === "done" ? "Completed" : comp.status === "partial" ? "Partial" : "Not started")
      : `${comp.pct}% complete`;
    const statusColor = comp.leaf
      ? (comp.status === "done" ? scoreColor(100)
         : comp.status === "partial" ? CONFIG.heatmap.partial : CONFIG.heatmap.unscored)
      : (comp.pct > 0 ? scoreColor(comp.pct) : CONFIG.heatmap.unscored);
    const links = Array.isArray(st.links) ? st.links : [];
    const linksHtml = links.length
      ? links.map((l) => `<a class="link-anchor" href="${escapeHtml(normalizeUrl(l.url))}" target="_blank" rel="noopener" title="${escapeHtml(normalizeUrl(l.url))}">${LINK_ICON}<span>${escapeHtml(l.label || l.url)}</span></a>`).join("")
      : `<div class="links-empty">No iPurple articles mapped yet.</div>`;

    pop.innerHTML = `
      <h3>${escapeHtml(tech.name)}</h3>
      <div class="pop-id">${escapeHtml(tech.id)}${tech.isSubtechnique ? " · sub-technique" : ""}</div>
      <div class="ro-status"><span class="ro-dot" style="background:${statusColor}"></span>${statusLabel}</div>
      <div class="pop-desc ro-desc">${escapeHtml(effectiveDescription(tech) || "No description.")}</div>
      <div class="pop-section-label">${LINK_ICON} iPurple article${links.length === 1 ? "" : "s"}</div>
      <div class="ro-links">${linksHtml}</div>
      <div class="pop-actions" style="justify-content:space-between;margin-top:14px">
        <a class="pop-link" href="${tech.url || "https://attack.mitre.org"}" target="_blank" rel="noopener">View on ATT&CK ↗</a>
        <button class="btn btn-primary btn-sm" id="roClose" type="button">Close</button>
      </div>`;
    pop.hidden = false;
    backdrop.hidden = false;
    positionPopover(pop, anchorEl);
    pop.querySelector("#roClose").addEventListener("click", closePopover);
    backdrop.addEventListener("click", closePopover, { once: true });
  }

  function openPopover(id, anchorEl) {
    const tech = state.techById.get(id);
    if (!tech) return;
    if (!EDIT) { openReadonlyPopover(tech, anchorEl); return; }
    state.activeTechId = id;
    const st = cellState(id);
    const pop = document.getElementById("popover");
    const backdrop = document.getElementById("popoverBackdrop");

    const desc = effectiveDescription(tech);
    pop.innerHTML = `
      <h3>${escapeHtml(tech.name)}</h3>
      <div class="pop-id">${escapeHtml(tech.id)}${tech.isSubtechnique ? " · sub-technique" : ""}</div>

      <div class="pop-section-label pop-desc-head">
        <span>Description${tech.custom ? "" : `<span class="edited-tag" id="descEditedTag" ${hasDescOverride(tech) ? "" : "hidden"}>edited</span>`}</span>
        <a href="#" class="pop-link pop-desc-edit" id="descEditToggle">✎ Edit</a>
      </div>
      <div class="pop-desc" id="descView">${escapeHtml(desc || "No description.")}</div>
      <div id="descEdit" hidden>
        <textarea class="pop-note pop-desc-input" id="descInput" placeholder="Technique description…">${escapeHtml(desc)}</textarea>
        <div class="pop-desc-tools">
          ${tech.custom ? "" : `<a href="#" class="pop-link btn-danger" id="descReset">Reset to original</a>`}
          <span class="hint">Applied when you press Save</span>
        </div>
      </div>

      <div class="pop-section-label">Completion</div>
      <div id="completionSection"></div>

      <div class="pop-section-label">${LINK_ICON} iPurple article</div>
      <div id="linksList"></div>
      <button class="btn btn-ghost btn-sm" id="addLinkBtn" type="button">+ Add article</button>

      <div class="pop-section-label">Note</div>
      <textarea class="pop-note" id="popNote" placeholder="Detection notes, data sources, playbook link…">${escapeHtml(st.note || "")}</textarea>

      <div class="pop-actions">
        <label class="pop-toggle-select">
          <input type="checkbox" id="enabledToggle" ${st.enabled === false ? "" : "checked"} /> Selected
        </label>
        ${tech.custom
          ? `<a class="pop-link" href="#" id="popEditTech">Edit / delete ✎</a>`
          : `<a class="pop-link" href="${tech.url}" target="_blank" rel="noopener">View on ATT&CK ↗</a>`}
      </div>
      <div class="pop-actions">
        <button class="btn btn-danger btn-ghost" id="popClear">Reset</button>
        <button class="btn btn-primary" id="popSave">Save</button>
      </div>
    `;

    // position near the clicked cell
    pop.hidden = false;
    backdrop.hidden = false;
    positionPopover(pop, anchorEl);

    // --- wire controls ---
    let working = {
      note: st.note || "",
      enabled: st.enabled !== false,
      desc,
      links: (Array.isArray(st.links) ? st.links : []).map((l) => ({ label: l.label || "", url: l.url || "" })),
    };

    // --- completion section (status changes save immediately) ---
    const completionSection = pop.querySelector("#completionSection");
    // a 3-state segmented control: none / partial / done
    const STATUSES = [
      { key: "none",    label: "Not started" },
      { key: "partial", label: "Partial" },
      { key: "done",    label: "Completed" },
    ];
    function segHtml(id, cur, cls) {
      return `<span class="status-seg ${cls}" data-id="${id}">` +
        STATUSES.map((s) =>
          `<button type="button" class="seg-${s.key} ${cur === s.key ? "active" : ""}" data-status="${s.key}" title="${s.label}">${s.label}</button>`
        ).join("") + `</span>`;
    }
    function renderCompletion() {
      const comp = techCompletion(tech);
      if (comp.leaf) {
        completionSection.innerHTML = segHtml(tech.id, comp.status, "status-seg-lg");
      } else {
        const subs = (state.childrenOf.get(tech.id) || []).slice().sort((a, b) => a.id.localeCompare(b.id));
        const rows = subs.map((s) =>
          `<div class="subrow">
             ${segHtml(s.id, leafStatus(s.id), "status-seg-sm")}
             <span class="subrow-label"><span class="subcheck-id">${escapeHtml(s.id)}</span> ${escapeHtml(s.name)}</span>
           </div>`).join("");
        const counts = [];
        if (comp.done) counts.push(`${comp.done} done`);
        if (comp.partial) counts.push(`${comp.partial} partial`);
        completionSection.innerHTML =
          `<div class="comp-summary">
             <div class="progress comp-bar"><div class="progress-fill" style="width:${comp.pct}%;background:${scoreColor(comp.pct)}"></div></div>
             <span class="comp-text">${comp.pct}%${counts.length ? " · " + counts.join(", ") : ""} of ${comp.total}</span>
           </div>
           <div class="comp-actions">
             <button class="btn btn-sm" id="markAllSubs" type="button">All complete</button>
             <button class="btn btn-sm btn-ghost" id="clearAllSubs" type="button">Clear all</button>
           </div>
           <div class="subcheck-list">${rows}</div>`;
        completionSection.querySelector("#markAllSubs").addEventListener("click", () => {
          subs.forEach((s) => setStatus(s.id, "done")); renderCompletion();
        });
        completionSection.querySelector("#clearAllSubs").addEventListener("click", () => {
          subs.forEach((s) => setStatus(s.id, "none")); renderCompletion();
        });
      }
      // wire every segmented control
      completionSection.querySelectorAll(".status-seg button").forEach((b) => {
        b.addEventListener("click", () => {
          setStatus(b.closest(".status-seg").dataset.id, b.dataset.status);
          renderCompletion();
        });
      });
    }
    renderCompletion();

    // --- iPurple articles editor ---
    // Saved articles render as clickable hyperlinks (view mode); a row only
    // shows the title/URL inputs while you're adding or editing it.
    const linksList = pop.querySelector("#linksList");
    function renderLinks() {
      linksList.innerHTML = "";
      if (!working.links.length) {
        linksList.innerHTML = `<div class="links-empty">No articles mapped yet.</div>`;
      }
      working.links.forEach((lnk, i) => {
        const row = document.createElement("div");
        row.className = "link-row";
        const editing = lnk._editing || !lnk.url.trim();

        if (editing) {
          row.innerHTML = `
            <input class="link-title" type="text" placeholder="Article title" value="${escapeHtml(lnk.label)}" />
            <div class="link-url-row">
              <input class="link-url" type="text" placeholder="https://ipurple.team/…" value="${escapeHtml(lnk.url)}" />
              <button class="link-done" type="button" title="Done">✓</button>
              <button class="link-del" type="button" title="Remove">&times;</button>
            </div>`;
          const titleEl = row.querySelector(".link-title");
          const urlEl = row.querySelector(".link-url");
          titleEl.addEventListener("input", () => working.links[i].label = titleEl.value);
          urlEl.addEventListener("input", () => working.links[i].url = urlEl.value);
          urlEl.addEventListener("keydown", (e) => { if (e.key === "Enter") row.querySelector(".link-done").click(); });
          row.querySelector(".link-done").addEventListener("click", () => {
            if (!urlEl.value.trim()) { urlEl.focus(); return; }
            working.links[i]._editing = false;
            renderLinks();
          });
          row.querySelector(".link-del").addEventListener("click", () => {
            working.links.splice(i, 1);
            renderLinks();
          });
        } else {
          row.classList.add("link-view");
          const href = normalizeUrl(lnk.url);
          const label = lnk.label || lnk.url;
          row.innerHTML = `
            <a class="link-anchor" href="${escapeHtml(href)}" target="_blank" rel="noopener" title="${escapeHtml(href)}">${LINK_ICON}<span>${escapeHtml(label)}</span></a>
            <button class="link-edit" type="button" title="Edit">✎</button>
            <button class="link-del" type="button" title="Remove">&times;</button>`;
          row.querySelector(".link-edit").addEventListener("click", () => {
            working.links[i]._editing = true;
            renderLinks();
          });
          row.querySelector(".link-del").addEventListener("click", () => {
            working.links.splice(i, 1);
            renderLinks();
          });
        }
        linksList.appendChild(row);
      });
    }
    renderLinks();
    pop.querySelector("#addLinkBtn").addEventListener("click", () => {
      working.links.push({ label: "", url: "", _editing: true });
      renderLinks();
      const last = linksList.querySelector(".link-row:last-child .link-title");
      if (last) last.focus();
    });

    // --- description editor ---
    const descView = pop.querySelector("#descView");
    const descEdit = pop.querySelector("#descEdit");
    const descInput = pop.querySelector("#descInput");
    const descToggle = pop.querySelector("#descEditToggle");
    descToggle.addEventListener("click", (e) => {
      e.preventDefault();
      const editing = !descEdit.hidden;
      if (editing) {
        descView.hidden = false; descEdit.hidden = true; descToggle.textContent = "✎ Edit";
      } else {
        descView.hidden = true; descEdit.hidden = false; descToggle.textContent = "Done";
        descInput.focus();
      }
    });
    descInput.addEventListener("input", () => {
      working.desc = descInput.value;
      descView.textContent = descInput.value || "No description.";
    });
    const descReset = pop.querySelector("#descReset");
    if (descReset) {
      descReset.addEventListener("click", (e) => {
        e.preventDefault();
        working.desc = tech.description || "";
        descInput.value = working.desc;
        descView.textContent = working.desc || "No description.";
        toast("Will reset to original on Save");
      });
    }

    pop.querySelector("#popNote").addEventListener("input", (e) => working.note = e.target.value);
    pop.querySelector("#enabledToggle").addEventListener("change", (e) => working.enabled = e.target.checked);

    pop.querySelector("#popSave").addEventListener("click", () => {
      // custom techniques keep their description on the technique object
      if (tech.custom && working.desc != null) {
        tech.description = working.desc.trim();
        persistCustom();
      }
      setTech(id, working);
      closePopover();
      toast("Saved");
    });
    pop.querySelector("#popClear").addEventListener("click", () => {
      delete state.layer.techniques[id];
      persist();
      refreshCompletion(id);
      closePopover();
      toast("Reset");
    });
    const editLink = pop.querySelector("#popEditTech");
    if (editLink) {
      editLink.addEventListener("click", (e) => {
        e.preventDefault();
        closePopover();
        openTechForm(id);
      });
    }
    backdrop.addEventListener("click", closePopover, { once: true });
  }

  function setTech(id, working) {
    const tech = state.techById.get(id);
    const existing = state.layer.techniques[id] || {};
    const clean = {};
    // completion status is managed separately (setStatus) — preserve it
    if (existing.status === "partial" || existing.status === "done") clean.status = existing.status;
    else if (existing.done) clean.status = "done";  // tolerate legacy
    if (working.note && working.note.trim()) clean.note = working.note.trim();
    if (working.enabled === false) clean.enabled = false;
    // description override — only for base techniques, and only when it
    // actually differs from the dataset text (so "reset" clears it)
    if (tech && !tech.custom && working.desc != null) {
      const base = (tech.description || "").trim();
      const edited = working.desc.trim();
      if (edited && edited !== base) clean.desc = edited;
    }
    // iPurple articles — keep rows that have a URL; default label to the URL
    if (Array.isArray(working.links)) {
      const links = working.links
        .map((l) => ({ label: (l.label || "").trim(), url: normalizeUrl(l.url) }))
        .filter((l) => l.url)
        .map((l) => ({ label: l.label || l.url, url: l.url }));
      if (links.length) clean.links = links;
    }
    if (Object.keys(clean).length) state.layer.techniques[id] = clean;
    else delete state.layer.techniques[id];
    persist();
    refreshCell(id);
    renderStatus();
  }

  function closePopover() {
    document.getElementById("popover").hidden = true;
    document.getElementById("popoverBackdrop").hidden = true;
    state.activeTechId = null;
  }

  /* ====================================================================== *
   *  ADD / EDIT CUSTOM TECHNIQUE
   * ====================================================================== */
  function rebuildAfterCustomChange() {
    applyCustom();
    renderMatrix();
    renderStatus();
  }

  function openTechForm(existingId) {
    const editing = existingId ? state.techById.get(existingId) : null;
    state.editingCustomId = editing ? existingId : null;

    const modal = document.getElementById("formModal");
    const backdrop = document.getElementById("modalBackdrop");

    const isSub = editing ? editing.isSubtechnique : false;
    const parents = topLevelTechniques();
    const parentOptions = parents
      .map((p) => `<option value="${p.id}" ${editing && editing.parent === p.id ? "selected" : ""}>${escapeHtml(p.id + " · " + p.name)}</option>`)
      .join("");

    const tacticChecks = state.data.tactics
      .map((t) => {
        const checked = editing ? editing.tactics.includes(t.shortname) : false;
        return `<label><input type="checkbox" class="tactic-check" value="${t.shortname}" ${checked ? "checked" : ""}/> ${escapeHtml(t.name)}</label>`;
      })
      .join("");

    modal.innerHTML = `
      <h2>${editing ? "Edit" : "Add"} technique</h2>
      <p style="color:var(--text-dim);margin-top:-6px">Custom entries are marked with ★ and saved with your layer.</p>
      <div class="form-grid">
        <div class="field">
          <label>Type</label>
          <div class="type-toggle" id="typeToggle">
            <label class="${!isSub ? "sel" : ""}"><input type="radio" name="ttype" value="technique" ${!isSub ? "checked" : ""}/> Technique</label>
            <label class="${isSub ? "sel" : ""}"><input type="radio" name="ttype" value="sub" ${isSub ? "checked" : ""}/> Sub-technique</label>
          </div>
        </div>

        <div class="field" id="parentField" style="${isSub ? "" : "display:none"}">
          <label>Parent technique</label>
          <select id="parentSelect">${parentOptions}</select>
          <span class="hint">The sub-technique appears under this technique, inheriting its tactics.</span>
        </div>

        <div class="field-row">
          <div class="field" style="flex:2">
            <label>Name</label>
            <input type="text" id="techName" placeholder="e.g. Abuse of Internal Tooling" value="${editing ? escapeHtml(editing.name) : ""}"/>
          </div>
          <div class="field" style="flex:1">
            <label>ID</label>
            <input type="text" id="techId" placeholder="auto" value="${editing ? escapeHtml(editing.id) : ""}"/>
          </div>
        </div>

        <div class="field" id="tacticField" style="${isSub ? "display:none" : ""}">
          <label>Map to tactics</label>
          <div class="tactic-checks" id="tacticChecks">${tacticChecks}</div>
        </div>

        <div class="field">
          <label>Description <span class="hint">(optional)</span></label>
          <textarea id="techDesc" placeholder="What the technique covers, detection notes…">${editing ? escapeHtml(editing.description || "") : ""}</textarea>
        </div>

        <div class="form-error" id="formError"></div>

        <div class="pop-actions" style="justify-content:space-between">
          ${editing ? `<button class="btn btn-danger btn-ghost" id="formDelete">Delete technique</button>` : `<button class="btn btn-ghost" id="formCancel">Cancel</button>`}
          <div style="display:flex;gap:8px">
            ${editing ? `<button class="btn btn-ghost" id="formCancel">Cancel</button>` : ""}
            <button class="btn btn-primary" id="formSave">${editing ? "Save changes" : "Add technique"}</button>
          </div>
        </div>
      </div>
    `;

    modal.hidden = false;
    backdrop.hidden = false;

    const typeRadios = modal.querySelectorAll('input[name="ttype"]');
    const parentField = modal.querySelector("#parentField");
    const tacticField = modal.querySelector("#tacticField");
    const parentSelect = modal.querySelector("#parentSelect");
    const idInput = modal.querySelector("#techId");

    function currentType() {
      return modal.querySelector('input[name="ttype"]:checked').value;
    }
    function suggestId() {
      if (editing) return; // never auto-overwrite an existing id
      idInput.value = currentType() === "sub"
        ? nextSubId(parentSelect.value)
        : nextTechId();
    }
    function syncType() {
      const sub = currentType() === "sub";
      parentField.style.display = sub ? "" : "none";
      tacticField.style.display = sub ? "none" : "";
      modal.querySelectorAll("#typeToggle label").forEach((l) =>
        l.classList.toggle("sel", l.querySelector("input").checked));
      suggestId();
    }
    typeRadios.forEach((r) => r.addEventListener("change", syncType));
    parentSelect.addEventListener("change", suggestId);
    if (!editing) suggestId();

    modal.querySelector("#formSave").addEventListener("click", () => saveCustomTech(modal));
    const cancelBtn = modal.querySelector("#formCancel");
    if (cancelBtn) cancelBtn.addEventListener("click", closeForm);
    const delBtn = modal.querySelector("#formDelete");
    if (delBtn) delBtn.addEventListener("click", () => deleteCustomTech(existingId));
    backdrop.addEventListener("click", closeForm, { once: true });
    modal.querySelector("#techName").focus();
  }

  function saveCustomTech(modal) {
    const errEl = modal.querySelector("#formError");
    const type = modal.querySelector('input[name="ttype"]:checked').value;
    const isSub = type === "sub";
    const name = modal.querySelector("#techName").value.trim();
    let id = modal.querySelector("#techId").value.trim().toUpperCase();
    const desc = modal.querySelector("#techDesc").value.trim();
    const parent = isSub ? modal.querySelector("#parentSelect").value : null;

    const fail = (m) => { errEl.textContent = m; };

    if (!name) return fail("Please enter a name.");
    if (!id) return fail("Please enter an ID.");
    if (!/^[A-Z0-9.]+$/.test(id)) return fail("ID may only contain letters, numbers and dots.");

    // uniqueness (allow keeping the same id when editing)
    if (id !== state.editingCustomId && state.techById.has(id)) {
      return fail(`ID ${id} already exists.`);
    }

    let tactics;
    if (isSub) {
      const parentTech = state.techById.get(parent);
      if (!parentTech) return fail("Choose a valid parent technique.");
      tactics = parentTech.tactics.slice();
    } else {
      tactics = [...modal.querySelectorAll(".tactic-check:checked")].map((c) => c.value);
      if (!tactics.length) return fail("Select at least one tactic to map this technique to.");
    }

    const obj = {
      id, name, tactics,
      isSubtechnique: isSub,
      parent: isSub ? parent : null,
      platforms: ["Windows"],
      url: "",
      description: desc,
      custom: true,
    };

    if (state.editingCustomId) {
      // if the id changed, migrate the layer entry
      if (id !== state.editingCustomId && state.layer.techniques[state.editingCustomId]) {
        state.layer.techniques[id] = state.layer.techniques[state.editingCustomId];
        delete state.layer.techniques[state.editingCustomId];
        persist();
      }
      const idx = state.custom.findIndex((t) => t.id === state.editingCustomId);
      if (idx >= 0) state.custom[idx] = obj; else state.custom.push(obj);
    } else {
      state.custom.push(obj);
    }
    persistCustom();
    rebuildAfterCustomChange();
    closeForm();
    toast(state.editingCustomId ? "Technique updated" : "Technique added");
  }

  function deleteCustomTech(id) {
    const t = state.techById.get(id);
    if (!t) return;
    const kids = state.custom.filter((c) => c.parent === id);
    const msg = kids.length
      ? `Delete ${id} and its ${kids.length} custom sub-technique(s)?`
      : `Delete custom technique ${id}?`;
    if (!confirm(msg)) return;
    const removeIds = new Set([id, ...kids.map((k) => k.id)]);
    state.custom = state.custom.filter((c) => !removeIds.has(c.id));
    removeIds.forEach((rid) => delete state.layer.techniques[rid]);
    persist();
    persistCustom();
    rebuildAfterCustomChange();
    closeForm();
    toast("Technique deleted");
  }

  function closeForm() {
    document.getElementById("formModal").hidden = true;
    document.getElementById("modalBackdrop").hidden = true;
    state.editingCustomId = null;
  }

  /* ====================================================================== *
   *  SEARCH
   * ====================================================================== */
  function runSearch(q) {
    state.search = q.trim().toLowerCase();
    const clearBtn = document.getElementById("searchClear");
    const countEl = document.getElementById("searchCount");
    clearBtn.style.display = q ? "block" : "none";

    const cells = document.querySelectorAll(".tech");
    if (!state.search) {
      cells.forEach((c) => c.classList.remove("search-hit", "search-dim"));
      countEl.textContent = "";
      // collapse any auto-expanded
      return;
    }

    let hits = 0;
    const matchedWraps = new Set();
    cells.forEach((c) => {
      const id = c.dataset.tech;
      const t = state.techById.get(id);
      const hay = `${t.id} ${t.name} ${t.description || ""}`.toLowerCase();
      const hit = hay.includes(state.search);
      c.classList.toggle("search-hit", hit);
      c.classList.toggle("search-dim", !hit);
      if (hit) {
        hits++;
        const wrap = c.closest(".tech-wrap");
        if (wrap) matchedWraps.add(wrap);
        // if a sub-technique matched, expand its parent group
        if (t.isSubtechnique && wrap) wrap.classList.add("expanded");
      }
    });
    // ensure parent cell of a matched group isn't dimmed away if it contains hits
    countEl.textContent = `${hits} match${hits === 1 ? "" : "es"}`;
  }

  /* ====================================================================== *
   *  ACTIONS / MENU
   * ====================================================================== */
  function runAction(action) {
    switch (action) {
      case "export": exportLayer(); break;
      case "import": document.getElementById("importFile").click(); break;
      case "clear": clearAll(); break;
      case "selectAll": setAllEnabled(true); break;
      case "deselectAll": setAllEnabled(false); break;
      case "expandAll": toggleAllExpanded(true); break;
      case "collapseAll": toggleAllExpanded(false); break;
      case "addTechnique": openTechForm(); break;
      case "help": openHelp(); break;
      default: console.warn("Unknown action:", action);
    }
  }

  function toggleAllExpanded(expand) {
    document.querySelectorAll(".tech-wrap").forEach((w) => {
      const toggle = w.querySelector(".subtech-toggle");
      if (!toggle) return;
      w.classList.toggle("expanded", expand);
      toggle.textContent = expand ? "–" : "+";
    });
  }

  function setAllEnabled(enabled) {
    for (const t of state.data.techniques) {
      const st = state.layer.techniques[t.id] || {};
      if (enabled) { delete st.enabled; }
      else { st.enabled = false; }
      if (Object.keys(st).length) state.layer.techniques[t.id] = st;
      else delete state.layer.techniques[t.id];
    }
    persist();
    refreshAllCells();
    toast(enabled ? "All selected" : "All deselected");
  }

  function clearAll() {
    if (!confirm("Clear all completion, notes, articles, and selection? This cannot be undone.")) return;
    state.layer.techniques = {};
    persist();
    refreshAllCells();
    toast("Layer cleared");
  }

  /* ====================================================================== *
   *  IMPORT / EXPORT  (Navigator-compatible-ish layer JSON)
   * ====================================================================== */
  function exportLayer() {
    const techniques = Object.entries(state.layer.techniques).map(([id, st]) => {
      const o = { techniqueID: id };
      const status = st.status || (st.done ? "done" : null);
      if (status === "done") {             // completed -> full score for Navigator compatibility
        o.status = "done"; o.score = 100; o.color = scoreColor(100);
      } else if (status === "partial") {   // partial -> half score + purple
        o.status = "partial"; o.score = 50; o.color = CONFIG.heatmap.partial;
      }
      if (st.note) o.comment = st.note;
      if (st.enabled === false) o.enabled = false;
      if (st.desc != null) o.description = st.desc;   // iPurple: edited description
      if (Array.isArray(st.links) && st.links.length) o.links = st.links; // iPurple articles
      return o;
    });
    const layer = {
      name: state.layer.name,
      versions: {
        layer: "4.5",
        navigator: "iPurple.team-1.0",
        attack: state.data.meta.attack_version,
      },
      domain: "enterprise-attack",
      description: state.layer.description,
      platform: state.data.meta.platform,
      gradient: {
        colors: activeStops().map((s) => s.color),
        minValue: 0,
        maxValue: 100,
      },
      techniques,
      // iPurple.team extension: carries user-defined techniques so layers
      // remain self-contained and portable across browsers/machines.
      customTechniques: state.custom,
    };
    const blob = new Blob([JSON.stringify(layer, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "coverage.json";   // drop into data/coverage.json and commit to publish
    a.click();
    URL.revokeObjectURL(url);
    toast(`Saved coverage.json (${techniques.length} techniques) → put it in data/ and commit`);
  }

  // Apply a parsed layer/coverage object into state (custom techniques +
  // per-technique status/notes/desc/articles). Returns the technique count.
  function applyLayerObject(obj) {
    if (!obj || !Array.isArray(obj.techniques)) throw new Error("No techniques array");

    // custom techniques first, indexed via applyCustom, so their ids resolve below
    state.custom = Array.isArray(obj.customTechniques)
      ? obj.customTechniques.filter((t) => t && t.id && t.name).map((t) => ({ ...t, custom: true }))
      : [];
    applyCustom();

    const next = {};
    for (const t of obj.techniques) {
      const id = t.techniqueID || t.id;
      if (!id || !state.techById.has(id)) continue;
      const st = {};
      // status from flag, or migrate older score layers (>=100 done, >0 partial)
      if (t.status === "done" || t.status === "partial") st.status = t.status;
      else if (t.done === true) st.status = "done";
      else if (t.score != null) {
        if (t.score >= 100) st.status = "done";
        else if (t.score > 0) st.status = "partial";
      }
      if (t.comment) st.note = t.comment;
      else if (t.note) st.note = t.note;
      if (t.enabled === false) st.enabled = false;
      if (t.description != null) st.desc = t.description;  // edited description
      if (Array.isArray(t.links) && t.links.length) {     // iPurple articles
        st.links = t.links
          .filter((l) => l && l.url)
          .map((l) => ({ label: l.label || l.url, url: l.url }));
      }
      if (Object.keys(st).length) next[id] = st;
    }
    state.layer.techniques = next;
    if (obj.name) state.layer.name = obj.name;
    if (obj.description) state.layer.description = obj.description;
    return Object.keys(next).length;
  }

  // Load the committed published coverage (the source of truth for visitors).
  async function loadCoverage() {
    try {
      const res = await fetch("data/coverage.json", { cache: "no-cache" });
      if (!res.ok) return;            // none published yet -> everything "not started"
      applyLayerObject(await res.json());
    } catch (e) { /* no coverage file */ }
  }

  function importLayer(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const n = applyLayerObject(JSON.parse(reader.result));
        persist();
        persistCustom();
        renderMatrix();
        renderStatus();
        toast(`Imported ${n} techniques`);
      } catch (e) {
        alert("Could not import layer: " + e.message);
      }
    };
    reader.readAsText(file);
  }

  /* ====================================================================== *
   *  PERSISTENCE
   * ====================================================================== */
  function persist() {
    if (!EDIT) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.layer));
    } catch (e) { /* storage full or disabled */ }
  }
  function restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && saved.techniques) {
          // migrate older layers to the status model (done flag / score → status)
          for (const st of Object.values(saved.techniques)) {
            if (!st || st.status) continue;
            if (st.done) st.status = "done";
            else if (st.score >= 100) st.status = "done";
            else if (st.score > 0) st.status = "partial";
            delete st.done; delete st.score;
          }
          state.layer = { ...state.layer, ...saved };
        }
      }
    } catch (e) { /* ignore */ }
  }

  /* ====================================================================== *
   *  HELP MODAL
   * ====================================================================== */
  function openHelp() {
    const modal = document.getElementById("helpModal");
    const backdrop = document.getElementById("modalBackdrop");
    modal.innerHTML = `
      <h2>${escapeHtml(CONFIG.brand.name)} ${escapeHtml(CONFIG.brand.productName)}</h2>
      <p style="color:var(--text-dim)">${escapeHtml(CONFIG.brand.tagline)} — built on MITRE ATT&CK® v${state.data.meta.attack_version}, ${state.data.meta.platform} Enterprise.</p>
      <h3>Tracking completion</h3>
      <ul>
        <li>Click any technique to open the editor.</li>
        <li>For a <strong>sub-technique</strong> (or a technique with no sub-techniques), set its status: <strong>Not started</strong>, <strong>Partial</strong> (purple), or <strong>Completed</strong> (green).</li>
        <li>For a technique <strong>with sub-techniques</strong>, set each sub-technique's status — the technique rolls up the % (partial counts as half). Use <em>All complete</em> / <em>Clear all</em> for the whole group.</li>
        <li>Completed items <strong>light up</strong> (green when done) on a neutral dark canvas; not-started items stay dark. A technique with sub-techniques tints by the % of its sub-techniques done. Tactic headers and the status bar show overall <strong>progress bars</strong>. Switch palette (<strong>Red → Orange → Green</strong> or <strong>Purple</strong>) in the legend; your choice is remembered.</li>
        <li>Map <strong>iPurple articles</strong> to a technique: add a title + URL (one or more). Cells show a link-count badge and the links travel with Export/Import.</li>
        <li>Add a <strong>note</strong> for detection logic, data sources, or a playbook link.</li>
        <li>Click <strong>✎ Edit</strong> next to the description to rewrite it for any technique or sub-technique; edited ones show an <em>edited</em> tag and <em>Reset to original</em> restores the MITRE text.</li>
        <li>Uncheck <strong>Selected</strong> to grey out techniques out of scope.</li>
      </ul>
      <h3>Sub-techniques</h3>
      <ul><li>Click the <code>+</code> on a technique to expand its sub-techniques, or use <em>View → Expand</em>.</li></ul>
      <h3>Adding your own techniques</h3>
      <ul>
        <li>Click <strong>+ Technique</strong> (top bar) to add a custom technique or sub-technique.</li>
        <li>For a <strong>technique</strong>, tick the <strong>tactics</strong> to map it to; for a <strong>sub-technique</strong>, pick a parent and it inherits the parent's tactics.</li>
        <li>An ID is auto-suggested (<code>TX0001</code>, or <code>&lt;parent&gt;.901</code>) but you can override it.</li>
        <li>Custom entries are marked with ★. Click one and choose <em>Edit / delete</em> to change it.</li>
        <li>They're saved with your layer and travel with Export/Import.</li>
      </ul>
      <h3>Search</h3>
      <ul><li>Search by name, technique ID (e.g. <code>T1059</code>), or description text. Matches are highlighted; non-matches dim.</li></ul>
      <h3>Publishing (edit locally, read-only for visitors)</h3>
      <ul>
        <li>Editing is available only when you run this <strong>locally</strong> (localhost). The published site is read-only — visitors see your coverage and can click through to the iPurple articles, but can't change anything.</li>
        <li>Work locally, then <em>Layer → Save coverage.json</em>, drop the file into <code>data/coverage.json</code>, and <code>git commit</code> + <code>git push</code>.</li>
        <li>That committed file is the single source of truth everyone sees.</li>
      </ul>
      <h3>Customizing</h3>
      <ul>
        <li>Edit <code>js/config.js</code> to change branding, theme colors, the heatmap gradient, score presets, and the menus — no build step.</li>
        <li>Refresh data with <code>node scripts/build-data.mjs</code>.</li>
      </ul>
      <div class="pop-actions" style="justify-content:flex-end">
        <button class="btn btn-primary" id="helpClose">Close</button>
      </div>
    `;
    modal.hidden = false;
    backdrop.hidden = false;
    modal.querySelector("#helpClose").addEventListener("click", closeHelp);
    backdrop.addEventListener("click", closeHelp, { once: true });
  }
  function closeHelp() {
    document.getElementById("helpModal").hidden = true;
    document.getElementById("modalBackdrop").hidden = true;
  }

  /* ====================================================================== *
   *  UTIL
   * ====================================================================== */
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function cssEscape(s) {
    return String(s).replace(/["\\]/g, "\\$&");
  }
  let toastTimer;
  function toast(msg) {
    let el = document.querySelector(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    requestAnimationFrame(() => el.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
  }

  /* ====================================================================== *
   *  BOOT
   * ====================================================================== */
  async function boot() {
    document.body.classList.toggle("read-only", !EDIT);

    // heatmap palette: visitors get the fixed config default; locally you may
    // switch (remembered). Colors are static for the published site.
    const fixed = getPalettes()[CONFIG.heatmap.active] ? CONFIG.heatmap.active : paletteKeys()[0];
    const saved = EDIT ? restorePalette() : null;
    state.palette = (saved && getPalettes()[saved]) ? saved : fixed;

    applyTheme();
    renderBrand();
    renderLegend();
    renderMenus();

    try {
      // no-cache => always revalidate, so a rebuilt dataset is picked up
      const res = await fetch("data/attack-windows.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.data = await res.json();
    } catch (e) {
      document.getElementById("matrix").innerHTML =
        `<div class="loading">Failed to load dataset (data/attack-windows.json): ${escapeHtml(e.message)}.<br>
         Run <code>node scripts/build-data.mjs</code> and serve over HTTP.</div>`;
      return;
    }

    state.baseTechniques = state.data.techniques.slice();
    applyCustom();           // index base so coverage ids resolve
    await loadCoverage();    // committed published coverage = source of truth
    if (EDIT) {              // overlay your local working copy, if any
      restore();
      restoreCustom();
    }
    applyCustom();           // re-compose with final custom set
    renderMatrix();
    renderStatus();

    // add custom technique (edit mode only)
    const addBtn = document.getElementById("addTechBtn");
    if (EDIT) {
      addBtn.addEventListener("click", () => openTechForm());
      document.getElementById("importFile").addEventListener("change", (e) => {
        if (e.target.files[0]) importLayer(e.target.files[0]);
        e.target.value = "";
      });
    } else {
      addBtn.style.display = "none";
    }

    // search
    const searchInput = document.getElementById("searchInput");
    searchInput.addEventListener("input", (e) => runSearch(e.target.value));
    document.getElementById("searchClear").addEventListener("click", () => {
      searchInput.value = "";
      runSearch("");
      searchInput.focus();
    });

    // keyboard
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closePopover(); closeHelp(); closeAllMenus(); }
      if (e.key === "/" && document.activeElement !== searchInput) {
        e.preventDefault(); searchInput.focus();
      }
    });
  }

  boot();
})();
