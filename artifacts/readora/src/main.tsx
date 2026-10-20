import { createRoot, hydrateRoot } from "react-dom/client";
import { Router as WouterRouter } from "wouter";
import App from "./App";
import { AboutPage } from "@/components/AboutPage";
import { AppProviders } from "@/components/AppProviders";
import { FeedbackPrompt } from "@/components/FeedbackPrompt";
import { LandingPage } from "@/components/LandingPage";
import type { LandingData } from "@/landing-data";
import "./index.css";

const root = document.getElementById("root")!;
const landingDataElement = document.getElementById("landing-data");

function readLandingData(): LandingData | null {
  if (!landingDataElement?.textContent) return null;
  try {
    const data = JSON.parse(landingDataElement.textContent) as LandingData;
    return Array.isArray(data.popularBooks) && isMaintenanceStatus(data.maintenanceStatus) && isRegistrationStatus(data.registrationStatus)
      ? data
      : null;
  } catch {
    return null;
  }
}

function isMaintenanceStatus(value: unknown): value is LandingData["maintenanceStatus"] {
  if (!value || typeof value !== "object") return false;
  const status = value as Record<string, unknown>;
  return (
    typeof status.enabled === "boolean" &&
    (typeof status.reason === "string" || status.reason === null) &&
    (typeof status.eta === "string" || status.eta === null) &&
    (typeof status.message === "string" || status.message === null)
  );
}

function isRegistrationStatus(value: unknown): value is LandingData["registrationStatus"] {
  return !!value && typeof value === "object" && typeof (value as Record<string, unknown>).enabled === "boolean";
}

const landingData = location.pathname === "/" ? readLandingData() : null;
if (landingData) {
  hydrateRoot(
    root,
    <AppProviders>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <FeedbackPrompt />
        <LandingPage
          popularBooks={landingData.popularBooks}
          maintenanceStatus={landingData.maintenanceStatus}
          registrationStatus={landingData.registrationStatus}
        />
      </WouterRouter>
    </AppProviders>,
  );
} else if (location.pathname === "/about") {
  hydrateRoot(
    root,
    <AppProviders>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <FeedbackPrompt />
        <AboutPage />
      </WouterRouter>
    </AppProviders>,
  );
} else {
  createRoot(root).render(<App />);
}

if ("serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		void navigator.serviceWorker.register("/sw.js");
	});
}
