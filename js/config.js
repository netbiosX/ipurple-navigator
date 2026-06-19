/* ==========================================================================
 * iPurple.team Navigator — EDITABLE CONFIGURATION
 * ==========================================================================
 * This is the one file you edit to rebrand, recolor, and re-menu the app.
 * No build step required — change values, save, refresh the browser.
 * ========================================================================== */

window.IPURPLE_CONFIG = {
  /* ---- Branding -------------------------------------------------------- */
  brand: {
    name: "iPurple.team",
    productName: "ATT&CK Navigator",
    tagline: "Purple Team Coverage Matrix",
    // Shown in the header. Use text or an emoji; swap for an <img> in index.html
    // if you have a logo file.
    logoText: "iP",
    footer: "iPurple.team · Built on MITRE ATT&CK® · Not affiliated with MITRE",
    website: "https://ipurple.team",
  },

  /* ---- Theme colors (black & purple) ----------------------------------
   * These map to CSS variables consumed by css/styles.css.
   * Tweak freely — everything updates on refresh.
   * -------------------------------------------------------------------- */
  theme: {
    "--bg":            "#0a0a0f",  // page background (near-black)
    "--bg-elev":       "#14111c",  // panels / header
    "--bg-cell":       "#1b1726",  // technique cell default
    "--bg-cell-hover": "#2a2138",
    "--border":        "#2d2440",
    "--text":          "#e8e3f2",
    "--text-dim":      "#9a8fb5",
    "--purple":        "#8b5cf6",  // primary purple
    "--purple-bright": "#a855f7",
    "--purple-deep":   "#6d28d9",
    "--accent":        "#c084fc",  // highlights, links, search match
    "--danger":        "#f43f5e",
    "--shadow":        "rgba(139, 92, 246, 0.25)",
  },

  /* ---- Heatmap palettes ------------------------------------------------
   * Scores run 0..100. Each palette has a label + gradient stops (sorted by
   * score); the cell color is interpolated between the surrounding stops.
   * Users switch palettes in the legend bar and the choice is remembered.
   * "unscored" is shared by all palettes (techniques with no score).
   * Add as many palettes as you like.
   * -------------------------------------------------------------------- */
  heatmap: {
    unscored: "#1b1726",
    partial: "#7c3aed",          // color for items marked "partial"
    active: "rag",               // default palette key (completed => green)
    palettes: {
      purple: {
        label: "Purple",
        stops: [
          { score: 0,   color: "#2a1a3a" }, // dark purple  (no/low coverage)
          { score: 33,  color: "#6d28d9" }, // deep purple
          { score: 66,  color: "#a855f7" }, // bright purple
          { score: 100, color: "#e9d5ff" }, // pale violet  (full coverage)
        ],
      },
      rag: {
        label: "Red → Orange → Green",
        stops: [
          { score: 0,   color: "#e53935" }, // red    (no/low coverage)
          { score: 50,  color: "#fb8c00" }, // orange (partial)
          { score: 100, color: "#43a047" }, // green  (full coverage)
        ],
      },
    },
  },

  /* ---- Custom menus ----------------------------------------------------
   * Top-right navigation. Two kinds of items:
   *   { label, href, external:true }      -> opens a link
   *   { label, action: "<built-in>" }     -> runs an app action
   * Built-in actions: "export", "import", "clear", "selectAll",
   *                    "deselectAll", "expandAll", "collapseAll",
   *                    "addTechnique", "help".
   * Add your own links (playbooks, wikis, dashboards) here.
   * -------------------------------------------------------------------- */
  menus: [
    {
      label: "Layer",
      items: [
        { label: "Add technique / sub-technique", action: "addTechnique" },
        { label: "Export layer (JSON)", action: "export" },
        { label: "Import layer (JSON)", action: "import" },
        { label: "Clear all progress",  action: "clear" },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Expand sub-techniques",   action: "expandAll" },
        { label: "Collapse sub-techniques", action: "collapseAll" },
        { label: "Select all",   action: "selectAll" },
        { label: "Deselect all", action: "deselectAll" },
      ],
    },
    {
      label: "iPurple",
      items: [
        { label: "iPurple.team",   href: "https://ipurple.team", external: true },
        { label: "MITRE ATT&CK",   href: "https://attack.mitre.org", external: true },
        { label: "About / Help",   action: "help" },
      ],
    },
  ],

  /* ---- Layer defaults -------------------------------------------------- */
  layer: {
    name: "iPurple.team Windows Layer",
    description: "Purple-team coverage layer for Windows Enterprise ATT&CK",
    // localStorage key used to auto-save your work in the browser
    storageKey: "ipurple-navigator-layer-v1",
  },
};
