import { renderToString } from "react-dom/server";
import { LandingPage } from "@/components/LandingPage";
import type { LandingData } from "@/landing-data";

type HomeDocumentInput = {
  template: string;
  publicBaseUrl: string;
  popularBooks: LandingData["popularBooks"];
};

function serializeLandingData(data: LandingData): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

export function renderHomeDocument({ template, publicBaseUrl, popularBooks }: HomeDocumentInput): string {
  const data = { popularBooks };
  return template
    .replaceAll("__PUBLIC_BASE_URL__", publicBaseUrl)
    .replace("<!--app-html-->", renderToString(<LandingPage popularBooks={popularBooks} />))
    .replace("<!--landing-data-->", `<script id="landing-data" type="application/json">${serializeLandingData(data)}</script>`);
}
