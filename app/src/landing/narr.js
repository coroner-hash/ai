// "In plain words": the Narrator's deterministic plain-language reading of a verdict, shown under the report.
import { narrate } from "../../worker/narrator.ts";

export function plainWords(v) {
  const box = document.createElement("section");
  box.className = "narr";
  const h = document.createElement("h2");
  h.className = "r-h";
  h.textContent = "In plain words";
  box.append(h);
  const lines = narrate(v).split("\n");
  let list = null;
  for (const line of lines) {
    if (line.startsWith("- ")) {
      if (!list) { list = document.createElement("ul"); box.append(list); }
      const li = document.createElement("li");
      li.textContent = line.slice(2);
      list.append(li);
    } else {
      list = null;
      const p = document.createElement("p");
      p.textContent = line;
      if (line.endsWith(":")) p.className = "narr-h";
      box.append(p);
    }
  }
  return box;
}
