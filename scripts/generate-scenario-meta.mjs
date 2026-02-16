import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const scenariosDir = path.join(rootDir, "scenarios");
const outputDir = path.join(rootDir, "public", "meta");
const outputPath = path.join(outputDir, "scenarios.json");

function safeJsonRead(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function buildScenarioMeta() {
  if (!fs.existsSync(scenariosDir)) return [];

  return fs
    .readdirSync(scenariosDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const scenario = safeJsonRead(path.join(scenariosDir, name));
      const id = path.basename(name, ".json");
      return {
        id,
        name: scenario?.name || id || "Unnamed scenario",
        description: scenario?.description || "",
        duration_seconds: Number(scenario?.duration_seconds || scenario?.durationSeconds || 0),
        version: scenario?.version || "1.0.0",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const scenarios = buildScenarioMeta();
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(scenarios, null, 2)}\n`, "utf8");
console.log(`Wrote ${scenarios.length} scenarios to ${path.relative(rootDir, outputPath)}`);
