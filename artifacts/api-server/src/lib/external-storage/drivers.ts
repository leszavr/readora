import { XMLParser } from "fast-xml-parser";
import type { ExternalStorageProvider } from "@workspace/db";

// Драйверы внешних хранилищ: Яндекс.Диск (REST API) и Облако Mail.ru (WebDAV).
// Оба сводятся к двум операциям: листинг папки и скачивание файла.

export type YandexDiskCredentials = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
};

export type MailRuCloudCredentials = {
  login: string;
  appPassword: string;
};

export type ExternalCredentials =
  | ({ provider: "yandex_disk" } & YandexDiskCredentials)
  | ({ provider: "mail_ru_cloud" } & MailRuCloudCredentials);

export type ExternalFileEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  etag: string | null;
  modifiedAt: Date | null;
};

export type ExternalStorageErrorKind = "auth" | "not_found" | "rate_limit" | "network" | "invalid_response";

export class ExternalStorageError extends Error {
  constructor(
    readonly kind: ExternalStorageErrorKind,
    message: string,
  ) {
    super(message);
  }
}

const YANDEX_API_BASE = "https://cloud-api.yandex.net/v1/disk";
const MAILRU_WEBDAV_BASE = "https://webdav.cloud.mail.ru";
const REQUEST_TIMEOUT_MS = 60_000;
const DOWNLOAD_MAX_BYTES = 500 * 1024 * 1024;

function errorFromStatus(status: number, provider: string, action: string): ExternalStorageError {
  if (status === 401 || status === 403) {
    return new ExternalStorageError("auth", `${provider}: доступ запрещён (${status})`);
  }
  if (status === 404) {
    return new ExternalStorageError("not_found", `${provider}: ресурс не найден`);
  }
  if (status === 429) {
    return new ExternalStorageError("rate_limit", `${provider}: превышен лимит запросов`);
  }
  return new ExternalStorageError("invalid_response", `${provider}: неожиданный ответ ${status} при ${action}`);
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (e) {
    throw new ExternalStorageError("network", e instanceof Error ? e.message : "Сетевая ошибка внешнего хранилища");
  }
}

function encodeDavPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

// --- Яндекс.Диск (REST API) ---

interface YandexResource {
  name?: string;
  type?: string;
  path?: string;
  size?: number;
  etag?: string;
  md5?: string;
  modified?: string;
  _embedded?: { items?: YandexResource[] };
}

function yandexEntry(item: YandexResource): ExternalFileEntry {
  return {
    name: item.name ?? "",
    path: item.path ?? "",
    isDir: item.type === "dir",
    size: typeof item.size === "number" ? item.size : 0,
    etag: item.etag ?? item.md5 ?? null,
    modifiedAt: item.modified ? new Date(item.modified) : null,
  };
}

async function yandexRequest(path: string, credentials: YandexDiskCredentials): Promise<unknown> {
  const res = await fetchWithTimeout(`${YANDEX_API_BASE}${path}`, {
    headers: { Authorization: `OAuth ${credentials.accessToken}` },
  });
  if (!res.ok) throw errorFromStatus(res.status, "Яндекс.Диск", path);
  return res.json();
}

async function listYandexFolder(credentials: YandexDiskCredentials, folderPath: string): Promise<ExternalFileEntry[]> {
  const data = (await yandexRequest(
    `/resources?path=${encodeURIComponent(folderPath)}&limit=1000`,
    credentials,
  )) as YandexResource;
  const items = data._embedded?.items ?? [];
  return items.map(yandexEntry);
}

// Читает тело ответа как буфер с проверкой размера: content-length — до
// скачивания (гигантский файл не грузится в память целиком), фактический
// размер — как страховка от отсутствующего/лгущего заголовка.
// Экспортировано для юнит-тестов.
export async function readDownloadBody(res: Response): Promise<Buffer> {
  const contentLength = Number(res.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > DOWNLOAD_MAX_BYTES) {
    throw new ExternalStorageError("invalid_response", "Файл внешнего хранилища превышает допустимый размер");
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > DOWNLOAD_MAX_BYTES) {
    throw new ExternalStorageError("invalid_response", "Файл внешнего хранилища превышает допустимый размер");
  }
  return buffer;
}

async function downloadYandexFile(credentials: YandexDiskCredentials, filePath: string): Promise<Buffer> {
  const link = (await yandexRequest(`/resources/download?path=${encodeURIComponent(filePath)}`, credentials)) as {
    href?: string;
  };
  if (!link.href) throw new ExternalStorageError("invalid_response", "Яндекс.Диск: пустая ссылка на скачивание");
  const res = await fetchWithTimeout(link.href, {});
  if (!res.ok) throw errorFromStatus(res.status, "Яндекс.Диск", "download");
  return readDownloadBody(res);
}

// --- Облако Mail.ru (WebDAV) ---

const DAV_PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getetag/><d:displayname/></d:prop></d:propfind>';

interface DavResponse {
  href?: string;
  propstat?: {
    status?: string;
    prop?: {
      displayname?: string;
      getcontentlength?: string | number;
      getlastmodified?: string;
      getetag?: string;
      resourcetype?: unknown;
    };
  };
}

function davBasicAuth(credentials: MailRuCloudCredentials): string {
  return `Basic ${Buffer.from(`${credentials.login}:${credentials.appPassword}`).toString("base64")}`;
}

export function davEntry(response: DavResponse): ExternalFileEntry | null {
  const prop = response.propstat?.prop;
  if (!response.href || !prop) return null;
  const decodedPath = decodeURIComponent(response.href.split("?")[0]);
  const isDir = typeof prop.resourcetype === "object" && prop.resourcetype !== null;
  const name = prop.displayname || decodedPath.split("/").filter(Boolean).pop() || "/";
  return {
    name,
    path: decodedPath.endsWith("/") && decodedPath.length > 1 ? decodedPath.slice(0, -1) : decodedPath,
    isDir,
    size: typeof prop.getcontentlength === "number" ? prop.getcontentlength : Number(prop.getcontentlength ?? 0) || 0,
    etag: typeof prop.getetag === "string" ? prop.getetag.replace(/^"|"$/g, "") : null,
    modifiedAt: prop.getlastmodified ? new Date(prop.getlastmodified) : null,
  };
}

// Разбор PROPFIND multistatus-ответа WebDAV в список ответов (для тестов и листинга).
export function parseDavMultistatus(xmlText: string): DavResponse[] {
  const xml = new XMLParser({
    ignoreAttributes: true,
    removeNSPrefix: true,
    parseTagValue: false,
  }).parse(xmlText) as { multistatus?: { response?: DavResponse | DavResponse[] } };

  const responses = xml.multistatus?.response;
  return Array.isArray(responses) ? responses : responses ? [responses] : [];
}

async function listMailRuFolder(credentials: MailRuCloudCredentials, folderPath: string): Promise<ExternalFileEntry[]> {
  const res = await fetchWithTimeout(`${MAILRU_WEBDAV_BASE}${encodeDavPath(folderPath || "/")}/`, {
    method: "PROPFIND",
    headers: {
      Authorization: davBasicAuth(credentials),
      Depth: "1",
      "Content-Type": "application/xml",
    },
    body: DAV_PROPFIND_BODY,
  });
  if (!res.ok) throw errorFromStatus(res.status, "Облако Mail.ru", "PROPFIND");

  const list = parseDavMultistatus(await res.text());
  const normalizedFolder = (folderPath || "/").replace(/\/+$/, "") || "/";
  const entries: ExternalFileEntry[] = [];
  for (const response of list) {
    const entry = davEntry(response);
    if (!entry) continue;
    const entryPath = entry.path.replace(/\/+$/, "") || "/";
    if (entryPath === normalizedFolder) continue;
    entries.push(entry);
  }
  return entries;
}

async function downloadMailRuFile(credentials: MailRuCloudCredentials, filePath: string): Promise<Buffer> {
  const res = await fetchWithTimeout(`${MAILRU_WEBDAV_BASE}${encodeDavPath(filePath)}`, {
    headers: { Authorization: davBasicAuth(credentials) },
  });
  if (!res.ok) throw errorFromStatus(res.status, "Облако Mail.ru", "download");
  return readDownloadBody(res);
}

// --- Единый интерфейс ---

export function listExternalFolder(
  credentials: ExternalCredentials,
  folderPath: string,
): Promise<ExternalFileEntry[]> {
  return credentials.provider === "yandex_disk"
    ? listYandexFolder(credentials, folderPath)
    : listMailRuFolder(credentials, folderPath);
}

export function downloadExternalFile(credentials: ExternalCredentials, filePath: string): Promise<Buffer> {
  return credentials.provider === "yandex_disk"
    ? downloadYandexFile(credentials, filePath)
    : downloadMailRuFile(credentials, filePath);
}

export type { ExternalStorageProvider };
