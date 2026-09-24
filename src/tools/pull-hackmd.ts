/**
 * Fetch public HackMD notes as markdown.
 *
 *   npm run pull-hackmd -- temp/urls.txt
 *   npm run pull-hackmd -- temp/urls.txt temp/hackmd
 *
 * Cache: temp/hackmd-raw/<id>.md (gitignored). Output named by title.
 */
import * as fs from "fs";
import * as path from "path";
import axios from "axios";

const DEFAULT_OUT = path.join("temp", "hackmd");
const DEFAULT_CACHE = path.join("temp", "hackmd-raw");

export interface PullNote {
  url: string;
  id: string;
  title: string;
  fileName: string;
  bytes: number;
  images: number;
}

function usage(): never {
  console.error(
    'Використання: npm run pull-hackmd -- <urls.txt> [папка]\n' +
      "Кожен рядок — https://hackmd.io/@user/id[/edit]",
  );
  process.exit(2);
}

function parseUrls(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

export function noteIdFromUrl(url: string): string | null {
  const u = url.trim().replace(/\/+$/, "");
  const team = u.match(/hackmd\.io\/@[^/]+\/([^/?#]+)/i);
  if (team) return team[1].replace(/\.md$/i, "");
  const bare = u.match(/hackmd\.io\/(?:s\/)?([^/?#]+)/i);
  if (bare && !bare[1].startsWith("@")) return bare[1].replace(/\.md$/i, "");
  return null;
}

export function markdownUrl(pageUrl: string): string {
  return pageUrl
    .trim()
    .replace(/\/edit\/?$/i, "")
    .replace(/\/+$/, "")
    .replace(/\.md$/i, "") + ".md";
}

export function stripHackmdYaml(text: string): string {
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!src.startsWith("---")) return src;
  const m = src.match(/^---\n[\s\S]*?\n---\n*/);
  return m ? src.slice(m[0].length) : src;
}

function titleOf(content: string, fallback: string): string {
  const yaml = content.match(/^---\n[\s\S]*?\ntitle:\s*(.+)\n[\s\S]*?\n---\n/);
  if (yaml) return yaml[1].trim().replace(/^['"]|['"]$/g, "");
  for (const line of stripHackmdYaml(content).split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("#") || t.startsWith("---")) continue;
    return t.replace(/\s*\([^)]*%[^)]*\)\s*$/, "").trim() || fallback;
  }
  return fallback;
}

function safeFileName(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, "").trim();
  return `${cleaned || "специфікація"}.md`;
}

function claimName(claimed: Set<string>, fileName: string): string {
  const stem = fileName.replace(/\.md$/i, "");
  let name = fileName;
  let i = 2;
  while (claimed.has(name.toLowerCase())) {
    name = `${stem} (${i}).md`;
    i++;
  }
  claimed.add(name.toLowerCase());
  return name;
}

function imageUrls(markdown: string): string[] {
  const found = new Set<string>();
  const re = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) found.add(m[1]);
  return [...found];
}

async function fetchText(url: string): Promise<string> {
  const res = await axios.get<string>(url, {
    responseType: "text",
    timeout: 30_000,
    headers: { Accept: "text/markdown, text/plain, */*" },
    validateStatus: (s) => s === 200,
  });
  return typeof res.data === "string" ? res.data : String(res.data);
}

async function fetchBin(url: string): Promise<Buffer> {
  const res = await axios.get<ArrayBuffer>(url, {
    responseType: "arraybuffer",
    timeout: 30_000,
    validateStatus: (s) => s === 200,
  });
  return Buffer.from(res.data);
}

export async function runPullHackmd(argv: string[]): Promise<void> {
  const listPath = argv[0];
  if (!listPath) usage();
  const absList = path.resolve(process.cwd(), listPath);
  if (!fs.existsSync(absList)) {
    console.error(`Файл не знайдено: ${absList}`);
    process.exit(2);
  }

  const outDir = path.resolve(process.cwd(), argv[1] ?? DEFAULT_OUT);
  const cacheDir = path.resolve(process.cwd(), DEFAULT_CACHE);
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  const urls = parseUrls(fs.readFileSync(absList, "utf-8"));
  if (!urls.length) {
    console.error("Порожній список URL.");
    process.exit(2);
  }

  const notes: PullNote[] = [];
  const claimed = new Set<string>();
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const id = noteIdFromUrl(url);
    if (!id) {
      console.error(`SKIP bad url: ${url}`);
      continue;
    }
    const cachePath = path.join(cacheDir, `${id}.md`);
    let raw: string;
    if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 0) {
      raw = fs.readFileSync(cachePath, "utf-8");
      console.log(`[${i + 1}/${urls.length}] cache ${id}`);
    } else {
      const mdUrl = markdownUrl(url);
      console.log(`[${i + 1}/${urls.length}] GET ${mdUrl}`);
      raw = await fetchText(mdUrl);
      fs.writeFileSync(cachePath, raw, "utf-8");
    }

    const title = titleOf(raw, id);
    const body = stripHackmdYaml(raw).replace(/\s+$/, "") + "\n";
    const fileName = claimName(claimed, safeFileName(title));
    fs.writeFileSync(path.join(outDir, fileName), body, "utf-8");

    const assetsDir = path.join(cacheDir, "assets", id);
    let images = 0;
    for (const img of imageUrls(body)) {
      fs.mkdirSync(assetsDir, { recursive: true });
      const base = path.basename(new URL(img).pathname) || `img-${images}`;
      try {
        fs.writeFileSync(path.join(assetsDir, base), await fetchBin(img));
        images++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  image fail ${img}: ${msg}`);
      }
    }

    notes.push({
      url,
      id,
      title,
      fileName,
      bytes: Buffer.byteLength(body),
      images,
    });
  }

  const manifestPath = path.join(outDir, "_manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(notes, null, 2)}\n`, "utf-8");
  console.log(`\nOK ${notes.length}/${urls.length} → ${path.relative(process.cwd(), outDir)}`);
  console.log(`manifest ${path.relative(process.cwd(), manifestPath)}`);
}

if (require.main === module) {
  runPullHackmd(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
