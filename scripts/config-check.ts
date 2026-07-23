/**
 * @id PP-CORE (config:check)
 * @name config-check
 * Derivable-facts guard for the `.claude` config. Counts active agents/skills and the staged-only
 * ones (present in docs/_claude-code-config but not yet promoted), reports each agent's pinned
 * model, and asserts every agent definition declares a `model:` in its frontmatter (cost/quality
 * governance). Fails on a missing model so the agent fleet cannot silently regress. The printed
 * facts are the source of truth for docs/06_CLAUDE_CODE_AGENTS.md. Run: `pnpm config:check`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const ROOT = process.cwd();

function listAgentFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => join(dir, name));
}

function listSkillDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, "SKILL.md")))
    .map((entry) => entry.name);
}

function frontmatter(file: string): string {
  const match = readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---/);
  return match?.[1] ?? "";
}

function modelOf(file: string): string {
  return (
    frontmatter(file)
      .match(/^model:\s*(.+?)\s*$/m)?.[1]
      ?.replace(/^["']|["']$/g, "") ?? "(none)"
  );
}

const activeAgents = listAgentFiles(join(ROOT, ".claude/agents"));
const stagedAgents = listAgentFiles(join(ROOT, "docs/_claude-code-config/agents"));
const activeSkills = listSkillDirs(join(ROOT, ".claude/skills"));
const stagedSkills = listSkillDirs(join(ROOT, "docs/_claude-code-config/skills"));

// Staged-only = present in the staging dir but not yet promoted to the active dir.
const activeAgentNames = new Set(activeAgents.map((file) => basename(file)));
const stagedOnlyAgents = stagedAgents.filter((file) => !activeAgentNames.has(basename(file)));
const stagedOnlySkills = stagedSkills.filter((name) => !activeSkills.includes(name));

const errors: string[] = [];
for (const file of [...activeAgents, ...stagedAgents]) {
  if (!/^model:\s*\S/m.test(frontmatter(file))) {
    errors.push(`Agent missing \`model:\` in frontmatter: ${file.replace(`${ROOT}/`, "")}`);
  }
}

console.log("Pool Party .claude config (source of truth for docs/06):");
console.log(`  active agents:      ${activeAgents.length}`);
console.log(`  staged-only agents: ${stagedOnlyAgents.length}`);
console.log(`  active skills:      ${activeSkills.length}`);
console.log(`  staged-only skills: ${stagedOnlySkills.length}`);

console.log("\nAgent models:");
for (const file of [...activeAgents, ...stagedOnlyAgents].sort()) {
  const staged = activeAgentNames.has(basename(file)) ? "" : " (staged)";
  console.log(`  ${basename(file, ".md").padEnd(24)} ${modelOf(file)}${staged}`);
}

if (errors.length > 0) {
  console.error(`\nconfig:check FAILED (${errors.length}):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log("\nconfig:check OK: every agent declares a model.");
