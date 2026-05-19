import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(rootDir, "src");
const distDir = join(rootDir, "dist");
const esmDir = join(distDir, "esm");
const cjsDir = join(distDir, "cjs");
const typesDir = join(distDir, "types");

const sourceFiles = (await listSourceFiles(srcDir))
  .filter((path) => !path.endsWith("legacy.reference.ts"));

await rm(distDir, { recursive: true, force: true });
await Promise.all([
  emitJavaScript({ module: ts.ModuleKind.ES2022, outDir: esmDir, extension: ".js" }),
  emitJavaScript({ module: ts.ModuleKind.CommonJS, outDir: cjsDir, extension: ".cjs" }),
]);
emitDeclarations();
await rewriteDeclarationSpecifiers(typesDir);

async function emitJavaScript({ module, outDir, extension }) {
  for (const sourcePath of sourceFiles) {
    const source = await readFile(sourcePath, "utf8");
    const transpiled = ts.transpileModule(source, {
      fileName: sourcePath,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
        isolatedModules: true,
        verbatimModuleSyntax: true,
      },
    });
    const relativePath = relative(srcDir, sourcePath).replace(/\.ts$/u, extension);
    const outputPath = join(outDir, relativePath);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, rewriteTsSpecifiers(transpiled.outputText, extension), "utf8");
  }
}

function emitDeclarations() {
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    declaration: true,
    emitDeclarationOnly: true,
    isolatedDeclarations: false,
    isolatedModules: true,
    verbatimModuleSyntax: true,
    allowImportingTsExtensions: true,
    skipLibCheck: true,
    rootDir: srcDir,
    outDir: typesDir,
    lib: ["lib.es2023.d.ts", "lib.dom.d.ts"],
    types: ["node"],
  };
  const host = ts.createCompilerHost(options);
  const program = ts.createProgram(sourceFiles, options, host);
  const emitResult = program.emit();
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(emitResult.diagnostics);
  if (diagnostics.length > 0) {
    const formatted = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => rootDir,
      getNewLine: () => "\n",
    });
    throw new Error(formatted);
  }
}

async function rewriteDeclarationSpecifiers(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      await rewriteDeclarationSpecifiers(entryPath);
      continue;
    }
    if (!entry.name.endsWith(".d.ts")) {
      continue;
    }
    const source = await readFile(entryPath, "utf8");
    await writeFile(entryPath, rewriteTsSpecifiers(source, ".js"), "utf8");
  }
}

async function listSourceFiles(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(path, entry.name);
      if (entry.isDirectory()) {
        return listSourceFiles(entryPath);
      }
      return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
    }),
  );
  return files.flat().sort((left, right) => left.localeCompare(right));
}

function rewriteTsSpecifiers(source, extension) {
  return source
    .replace(/((?:from|import)\s*["'])(\.{1,2}\/[^"']+)\.ts(["'])/gu, `$1$2${extension}$3`)
    .replace(/(import\(["'])(\.{1,2}\/[^"']+)\.ts(["']\))/gu, `$1$2${extension}$3`)
    .replace(/(require\(["'])(\.{1,2}\/[^"']+)\.ts(["']\))/gu, `$1$2${extension}$3`);
}
