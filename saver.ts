import fs from "fs";
import path from "path";

type Node =
  | {
      type: "directory";
      name: string;
      children: Node[];
    }
  | {
      type: "file";
      name: string;
      content: string;
    };

function readDirRecursive(dir: string): Node {
  const stat = fs.statSync(dir);

  if (stat.isDirectory()) {
    return {
      type: "directory",
      name: path.basename(dir),
      children: fs
        .readdirSync(dir)
        .filter((x) => x !== "node_modules" && x !== ".git")
        .map((x) => readDirRecursive(path.join(dir, x))),
    };
  }

  return {
    type: "file",
    name: path.basename(dir),
    content: fs.readFileSync(dir, "utf8"),
  };
}

const target = process.argv[2] || ".";
const result = readDirRecursive(target);

fs.writeFileSync("folder.txt", JSON.stringify(result, null, 2));

console.log("saved to folder.txt");
