import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./App";
import { LandingPage } from "@/components/LandingPage";
import type { LandingData } from "@/landing-data";
import "./index.css";

const root = document.getElementById("root")!;
const landingDataElement = document.getElementById("landing-data");

function readLandingData(): LandingData | null {
  if (!landingDataElement?.textContent) return null;
  try {
    const data = JSON.parse(landingDataElement.textContent) as LandingData;
    return Array.isArray(data.popularBooks) ? data : null;
  } catch {
    return null;
  }
}

const landingData = location.pathname === "/" ? readLandingData() : null;
if (landingData) {
  hydrateRoot(root, <LandingPage popularBooks={landingData.popularBooks} />);
} else {
  createRoot(root).render(<App />);
}

if ("serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		void navigator.serviceWorker.register("/sw.js");
	});
}
