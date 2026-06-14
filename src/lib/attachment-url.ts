export function isExternalAttachmentUrl(fileKey: string): boolean {
  return /^https?:\/\//i.test(fileKey);
}

export function getAttachmentUrl(fileKey: string): string {
  if (fileKey.startsWith("/")) return fileKey;
  return isExternalAttachmentUrl(fileKey) ? fileKey : `/api/${fileKey}`;
}
