function normalizePublicBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("PUBLIC_BASE_URL must use http or https");
  }
  return url.toString().replace(/\/$/, "");
}

export function getPublicBaseUrl(): string {
  const value = process.env.PUBLIC_BASE_URL ?? process.env.APP_ORIGIN;
  if (!value) {
    throw new Error("PUBLIC_BASE_URL or APP_ORIGIN is required to generate public SEO URLs");
  }
  return normalizePublicBaseUrl(value);
}
