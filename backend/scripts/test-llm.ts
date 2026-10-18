import { chat } from "../src/llms/index.js";

const reply = await chat(
  [
    { role: "system", content: 'Reply only with JSON of the form {"greeting": "..."}.' },
    { role: "user", content: "Say hello to a telecom support engineer." },
  ],
  { json: true, temperature: 0.2 },
);

const parsed = JSON.parse(reply) as { greeting: string };
console.log("Parsed:", parsed);
