export function isExternalAttachmentUrl(fileKey: string): boolean {
  return /^https?:\/\//i.test(fileKey);
}

export function getAttachmentUrl(fileKey: string): string {
  return isExternalAttachmentUrl(fileKey) ? fileKey : `/api/${fileKey}`;
}
