export type BedVersionId = "original" | "upd-1" | "upd-2";

export type BedVersionOpt = {
  id: BedVersionId;
  label: string;
  /** Basename without .md */
  file: "original" | "upd-1" | "fixed";
};

/** `fixed.md` = latest (upd 1 or upd 2); `upd-1.md` = snapshot before Vadim 18.11 */
export function bedVersions(
  vadimReview: string | undefined,
  has: { original: boolean; upd1Snap: boolean; fixed: boolean },
): BedVersionOpt[] {
  const out: BedVersionOpt[] = [];
  if (has.original) out.push({ id: "original", label: "original", file: "original" });
  if (has.upd1Snap) {
    out.push({ id: "upd-1", label: "upd 1", file: "upd-1" });
  } else if (has.fixed && vadimReview === "upd-1") {
    out.push({ id: "upd-1", label: "upd 1", file: "fixed" });
  }
  if (has.fixed && vadimReview === "upd-2") {
    out.push({ id: "upd-2", label: "upd 2", file: "fixed" });
  }
  return out;
}

export function latestBedVersion(opts: BedVersionOpt[]): BedVersionId {
  if (opts.some((o) => o.id === "upd-2")) return "upd-2";
  if (opts.some((o) => o.id === "upd-1")) return "upd-1";
  return "original";
}

export function bedVersionFile(
  opts: BedVersionOpt[],
  id: BedVersionId,
): BedVersionOpt["file"] | null {
  return opts.find((o) => o.id === id)?.file ?? null;
}