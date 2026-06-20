export function withVersionedAssetUrl(pathOrUrl: string, version: string) {
  const hashIndex = pathOrUrl.indexOf("#");
  const hash = hashIndex >= 0 ? pathOrUrl.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? pathOrUrl.slice(0, hashIndex) : pathOrUrl;
  const queryIndex = withoutHash.indexOf("?");
  const base = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const search = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "";
  const params = new URLSearchParams(search);

  params.set("v", version);

  const nextSearch = params.toString();
  return nextSearch ? `${base}?${nextSearch}${hash}` : `${base}${hash}`;
}
