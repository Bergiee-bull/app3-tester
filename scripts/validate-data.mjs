import fs from "node:fs";
import { validateAssetRegistry } from "../src/asset_registry.js";
import { validateBenchmarkData } from "../src/benchmark_data.js";
import { validatePublicSignal } from "../src/signal.js";

const signalPath = process.argv[2] || new URL("../data/app3_signal.json", import.meta.url);
const benchmarkPath = process.argv[3] || new URL("../data/benchmark_series.json", import.meta.url);
const signal = JSON.parse(fs.readFileSync(signalPath, "utf8"));
const registry = JSON.parse(fs.readFileSync(new URL("../data/asset_registry.json", import.meta.url), "utf8"));
const benchmarks = JSON.parse(fs.readFileSync(benchmarkPath, "utf8"));
const validation = validatePublicSignal(signal);

if (!validation.valid) throw new Error(validation.errors.join("\n"));
if (!validateAssetRegistry(registry)) throw new Error("asset_registry.json är ogiltig");
if (!validateBenchmarkData(benchmarks)) throw new Error("benchmark_series.json är ogiltig");
if (!registry[signal.signal.recommended_asset] || !registry[signal.signal.previous_asset]) {
  throw new Error("Signalen refererar till en tillgång som saknas i registret");
}
console.log("Public signal, asset registry, and benchmark data are valid.");
