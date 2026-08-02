import { resolve } from "node:path";
import { seedEcosystemQueries } from "../search/ecosystem/dataset.js";

const releaseRoot = resolve(process.argv[2] ?? "eval-dataset");
const ecosystemRoot = resolve(process.argv[3] ?? "eval-dataset/ecosystem");
const queries = await seedEcosystemQueries(releaseRoot, ecosystemRoot);
console.log(JSON.stringify({ ecosystemRoot, queries }, null, 2));
