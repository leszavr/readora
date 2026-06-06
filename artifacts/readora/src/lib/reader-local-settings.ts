// Local storage for reader settings (device-specific, no cloud sync)
// Uses unique key to avoid conflicts and versioning for migrations

import type { ReaderSettingsInputTheme } from "@workspace/api-client-react";

export interface ReaderLocalSettings {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  theme: "light" | "sepia" | "dark";
  contentWidth: number;
  // Version for future migrations
  _version: number;
}

type DeviceMode = "desktop" | "mobile";

const SETTINGS_STORAGE_KEY = "readora:reader-settings:v1";
const CURRENT_VERSION = 1;

const DEFAULT_SETTINGS: ReaderLocalSettings = {
  fontSize: 18,
  fontFamily: "Georgia",
  lineHeight: 1.7,
  theme: "light",
  contentWidth: 80, // Will be adjusted based on device mode
  _version: CURRENT_VERSION,
};

const FONTS = ["Georgia", "Arial", "Times New Roman", "Verdana", "Palatino"];

function getDefaultContentWidth(deviceMode: DeviceMode): number {
  return deviceMode === "mobile" ? 95 : 80;
}

function isValidFontFamily(font: string): boolean {
  return FONTS.includes(font);
}

function isValidTheme(theme: string): theme is ReaderLocalSettings["theme"] {
  return ["light", "sepia", "dark"].includes(theme);
}

function getSettingsStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function migrateSettings(settings: Partial<ReaderLocalSettings>): ReaderLocalSettings {
  // Future migrations can be added here
  // For now, just ensure all fields have valid values
  return {
    fontSize: typeof settings.fontSize === "number" && settings.fontSize >= 12 && settings.fontSize <= 32
      ? settings.fontSize
      : DEFAULT_SETTINGS.fontSize,
    fontFamily: isValidFontFamily(settings.fontFamily ?? "")
      ? settings.fontFamily!
      : DEFAULT_SETTINGS.fontFamily,
    lineHeight: typeof settings.lineHeight === "number" && settings.lineHeight >= 1.2 && settings.lineHeight <= 2.5
      ? settings.lineHeight
      : DEFAULT_SETTINGS.lineHeight,
    theme: isValidTheme(settings.theme ?? "")
      ? settings.theme!
      : DEFAULT_SETTINGS.theme,
    contentWidth: typeof settings.contentWidth === "number" && settings.contentWidth >= 50 && settings.contentWidth <= 95
      ? settings.contentWidth
      : DEFAULT_SETTINGS.contentWidth,
    _version: CURRENT_VERSION,
  };
}

export function loadReaderSettingsFromStorage(deviceMode: DeviceMode): ReaderLocalSettings {
  const storage = getSettingsStorage();
  if (!storage) {
    return {
      ...DEFAULT_SETTINGS,
      contentWidth: getDefaultContentWidth(deviceMode),
    };
  }

  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return {
        ...DEFAULT_SETTINGS,
        contentWidth: getDefaultContentWidth(deviceMode),
      };
    }

    const parsed = JSON.parse(raw) as Partial<ReaderLocalSettings>;
    const migrated = migrateSettings(parsed);
    
    // Adjust content width based on current device mode
    return {
      ...migrated,
      contentWidth: getDefaultContentWidth(deviceMode),
    };
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      contentWidth: getDefaultContentWidth(deviceMode),
    };
  }
}

export function saveReaderSettingsToStorage(settings: Omit<ReaderLocalSettings, "_version">): void {
  const storage = getSettingsStorage();
  if (!storage) {
    return;
  }

  try {
    const settingsWithVersion: ReaderLocalSettings = {
      ...settings,
      _version: CURRENT_VERSION,
    };
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settingsWithVersion));
  } catch {
    // Ignore storage quota and privacy mode failures
  }
}

// Helper to merge server settings with local settings
// Local settings take precedence (device-specific preference)
export function mergeSettings(
  localSettings: ReaderLocalSettings,
  serverSettings: {
    fontSize?: number;
    fontFamily?: string;
    lineHeight?: number;
    theme?: ReaderSettingsInputTheme;
    contentWidth?: number;
  } | null | undefined,
  deviceMode: DeviceMode
): ReaderLocalSettings {
  // If no local settings were ever saved (check by comparing with defaults),
  // use server settings as fallback
  const storage = getSettingsStorage();
  const hasLocalSettings = storage?.getItem(SETTINGS_STORAGE_KEY) !== null;

  if (!hasLocalSettings && serverSettings) {
    return {
      fontSize: serverSettings.fontSize ?? DEFAULT_SETTINGS.fontSize,
      fontFamily: serverSettings.fontFamily ?? DEFAULT_SETTINGS.fontFamily,
      lineHeight: serverSettings.lineHeight ?? DEFAULT_SETTINGS.lineHeight,
      theme: (serverSettings.theme as ReaderLocalSettings["theme"]) ?? DEFAULT_SETTINGS.theme,
      contentWidth: getDefaultContentWidth(deviceMode),
      _version: CURRENT_VERSION,
    };
  }

  // Otherwise, prefer local settings (device-specific)
  return {
    ...localSettings,
    contentWidth: getDefaultContentWidth(deviceMode),
  };
}