function normalize(path: string): string {
  const slashed = path.replace(/\\/g, "/");
  const unc = slashed.startsWith("//");
  let value = slashed.replace(/\/{2,}/g, "/");
  if (unc) value = `/${value}`;
  if (value.length > 1 && !/^[A-Za-z]:\/$/.test(value)) {
    value = value.replace(/\/+$/, "");
  }
  return value;
}

function comparable(path: string, caseInsensitive: boolean): string {
  const value = normalize(path);
  return caseInsensitive ? value.toLocaleLowerCase("en-US") : value;
}

function atOrBelow(path: string, root: string): boolean {
  return (
    path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`)
  );
}

export function pathsOverlap(
  left: string,
  right: string,
  caseInsensitive: boolean,
): boolean {
  const a = comparable(left, caseInsensitive);
  const b = comparable(right, caseInsensitive);
  return atOrBelow(a, b) || atOrBelow(b, a);
}

export function rebasePath(
  path: string,
  oldRoot: string,
  newRoot: string,
  caseInsensitive: boolean,
): string {
  const value = normalize(path);
  const oldValue = normalize(oldRoot);
  if (
    !atOrBelow(
      comparable(value, caseInsensitive),
      comparable(oldValue, caseInsensitive),
    )
  ) {
    return path;
  }
  const suffix = value.slice(oldValue.length).replace(/^\/+/, "");
  const root = normalize(newRoot);
  if (!suffix) return root;
  return root.endsWith("/") ? `${root}${suffix}` : `${root}/${suffix}`;
}
