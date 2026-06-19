#!/usr/bin/env node
/**
 * build-data.mjs
 * --------------------------------------------------------------------------
 * Downloads the live MITRE ATT&CK Enterprise STIX bundle (or reads a local
 * copy) and produces a compact, Windows-only dataset for the iPurple.team
 * Navigator.
 *
 * Usage:
 *   node scripts/build-data.mjs            # fetch live data, then build
 *   node scripts/build-data.mjs --local    # use ./raw/enterprise-attack.json
 *
 * Output: data/attack-windows.json
 *
 * To target a different platform, change PLATFORM below (e.g. "Linux",
 * "macOS"). To include multiple platforms, edit the filter in buildDataset().
 * --------------------------------------------------------------------------
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SOURCE_URL =
  "https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json";
const RAW_PATH = path.join(ROOT, "raw", "enterprise-attack.json");
const OUT_PATH = path.join(ROOT, "data", "attack-windows.json");

const PLATFORM = "Windows";

function attackId(obj) {
  const ref = (obj.external_references || []).find(
    (r) => r.source_name === "mitre-attack"
  );
  return ref ? ref.external_id : null;
}

function attackUrl(obj) {
  const ref = (obj.external_references || []).find(
    (r) => r.source_name === "mitre-attack"
  );
  return ref ? ref.url : null;
}

// Keep the FULL ATT&CK description, but tidy it for plain-text display:
//  - drop "(Citation: …)" markers
//  - turn markdown links "[text](url)" into "text"
//  - strip leftover markdown emphasis/backticks
//  - collapse excess blank lines
function cleanDescription(s) {
  if (!s) return "";
  return s
    .replace(/\(Citation:[^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`{1,3}/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function loadBundle(useLocal) {
  if (useLocal || existsSync(RAW_PATH)) {
    if (!existsSync(RAW_PATH)) {
      throw new Error(`--local set but ${RAW_PATH} not found`);
    }
    console.log(`Reading local bundle: ${RAW_PATH}`);
    return JSON.parse(await readFile(RAW_PATH, "utf8"));
  }
  console.log(`Fetching live STIX bundle:\n  ${SOURCE_URL}`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching STIX bundle`);
  return await res.json();
}

function buildDataset(bundle) {
  const objs = bundle.objects;

  // --- tactic order from the enterprise matrix ---
  const matrix = objs.find((o) => o.type === "x-mitre-matrix");
  const tacticById = new Map();
  for (const o of objs) {
    if (o.type === "x-mitre-tactic") tacticById.set(o.id, o);
  }
  const tactics = matrix.tactic_refs
    .map((id) => tacticById.get(id))
    .filter(Boolean)
    .map((t) => ({
      id: attackId(t),
      name: t.name,
      shortname: t.x_mitre_shortname,
      url: attackUrl(t),
    }));

  // --- techniques (Windows, not revoked/deprecated) ---
  const isLive = (o) => !o.revoked && !o.x_mitre_deprecated;
  const patterns = objs.filter(
    (o) =>
      o.type === "attack-pattern" &&
      isLive(o) &&
      (o.x_mitre_platforms || []).includes(PLATFORM)
  );

  // map STIX id -> attack id, to resolve sub-technique parents
  const stixToAttack = new Map();
  for (const p of patterns) stixToAttack.set(p.id, attackId(p));

  // sub-technique -> parent relationships
  const parentOf = new Map();
  for (const o of objs) {
    if (o.type === "relationship" && o.relationship_type === "subtechnique-of") {
      parentOf.set(o.source_ref, o.target_ref);
    }
  }

  const techniques = patterns.map((p) => {
    const id = attackId(p);
    const tacticShortnames = (p.kill_chain_phases || [])
      .filter((k) => k.kill_chain_name === "mitre-attack")
      .map((k) => k.phase_name);
    let parent = null;
    if (p.x_mitre_is_subtechnique) {
      const parentStix = parentOf.get(p.id);
      parent = parentStix ? stixToAttack.get(parentStix) : null;
      if (!parent && id.includes(".")) parent = id.split(".")[0];
    }
    return {
      id,
      name: p.name,
      tactics: tacticShortnames,
      isSubtechnique: !!p.x_mitre_is_subtechnique,
      parent,
      platforms: p.x_mitre_platforms || [],
      url: attackUrl(p),
      description: cleanDescription(p.description),
    };
  });

  // Keep only tactics that actually have at least one Windows technique
  const usedShortnames = new Set();
  for (const t of techniques) t.tactics.forEach((s) => usedShortnames.add(s));
  const usedTactics = tactics.filter((t) => usedShortnames.has(t.shortname));

  return {
    meta: {
      domain: "enterprise-attack",
      platform: PLATFORM,
      attack_version: bundle.objects.find((o) => o.type === "x-mitre-collection")
        ?.x_mitre_version || "unknown",
      generated: new Date().toISOString(),
      source: SOURCE_URL,
      tactic_count: usedTactics.length,
      technique_count: techniques.filter((t) => !t.isSubtechnique).length,
      subtechnique_count: techniques.filter((t) => t.isSubtechnique).length,
    },
    tactics: usedTactics,
    techniques,
  };
}

async function main() {
  const useLocal = process.argv.includes("--local");
  const bundle = await loadBundle(useLocal);
  const dataset = buildDataset(bundle);
  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(dataset), "utf8");
  const { meta } = dataset;
  console.log("\n=== iPurple.team dataset built ===");
  console.log(`  ATT&CK version : ${meta.attack_version}`);
  console.log(`  Platform       : ${meta.platform}`);
  console.log(`  Tactics        : ${meta.tactic_count}`);
  console.log(`  Techniques     : ${meta.technique_count}`);
  console.log(`  Sub-techniques : ${meta.subtechnique_count}`);
  console.log(`  Output         : ${path.relative(ROOT, OUT_PATH)}`);
}

main().catch((e) => {
  console.error("BUILD FAILED:", e.message);
  process.exit(1);
});
