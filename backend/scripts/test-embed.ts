import { embed } from "../src/embedders/local-minilm.js";

const vector = await embed("hello");
console.log("Vector length:", vector.length);
console.log("First 5:", vector.slice(0, 5));
