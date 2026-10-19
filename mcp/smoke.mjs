// Smoke test: start the server over stdio, list the tools, call each one. Usage: node smoke.mjs [address]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const addr = process.argv[2] ?? "0x84bbcc13a9d92ee0a069b822929e7edcce300bfc";
const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["server.mjs"] }));
const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));
const show = (r) => console.log(r.isError ? "ERROR: " : "", (r.content[0].text ?? "").slice(0, 700), "\n---");
show(await client.callTool({ name: "check_token", arguments: { address: addr } }));
show(await client.callTool({ name: "premortem", arguments: { name: "Tacocat", symbol: "TACO", buyTaxPct: 5, sellTaxPct: 10, liquidityLock: "none", hasMint: true } }));
show(await client.callTool({ name: "autopsy_token", arguments: { address: addr } }));
show(await client.callTool({ name: "check_token", arguments: { address: "nope" } }));
await client.close();
