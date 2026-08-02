import { resolve } from "node:path";
import { refreshEcosystemDataset } from "../search/ecosystem/dataset.js";

const root = resolve(process.argv[2] ?? "eval-dataset/ecosystem");
console.log(JSON.stringify(await refreshEcosystemDataset(root), null, 2));
