import { readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function javascriptFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await javascriptFiles(full)));
    else if (entry.name.endsWith(".js")) found.push(full.split(path.sep).join("/"));
  }
  return found.sort();
}

describe("vercel function budget", () => {
  it("keeps the API to one serverless function", async () => {
    expect(await javascriptFiles("api")).toEqual(["api/index.js"]);
  });
});