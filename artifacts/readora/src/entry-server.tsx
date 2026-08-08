import { renderToString } from "react-dom/server";
import { AboutPage, aboutFaqItems } from "@/components/AboutPage";
import { AppProviders } from "@/components/AppProviders";
import { LandingPage } from "@/components/LandingPage";
import type { LandingData } from "@/landing-data";

const homePageMetadata = {
  title: "Readora — личная веб-библиотека для чтения книг FB2 и EPUB",
  description: "Readora — личная веб-библиотека для чтения книг FB2 и EPUB. Загружайте, организуйте и читайте книги прямо в браузере с настраиваемым ридером, автосохранением прогресса и полным интерфейсом на русском языке.",
  path: "/",
};

const aboutPageMetadata = {
  title: "О Readora.ru — независимая личная веб-библиотека FB2 и EPUB",
  description: "Readora.ru — самостоятельный веб-сервис для личной библиотеки и чтения FB2 и EPUB. Без платных подписок, рекламы и платёжных данных.",
  path: "/about",
};

type HomeDocumentInput = {
  template: string;
  publicBaseUrl: string;
  popularBooks: LandingData["popularBooks"];
};

type PageMetadata = typeof homePageMetadata | typeof aboutPageMetadata;

function serializeJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function renderJsonLd(data: unknown): string {
  return `<script type="application/ld+json">${serializeJson(data)}</script>`;
}

function renderTemplate(template: string, publicBaseUrl: string, metadata: PageMetadata, structuredData = ""): string {
  const canonicalUrl = `${publicBaseUrl}${metadata.path === "/" ? "/" : metadata.path}`;
  return template
    .replaceAll("__PUBLIC_BASE_URL__", publicBaseUrl)
    .replaceAll("__PAGE_TITLE__", metadata.title)
    .replaceAll("__PAGE_DESCRIPTION__", metadata.description)
    .replaceAll("__CANONICAL_URL__", canonicalUrl)
    .replace("<!--page-structured-data-->", structuredData);
}

function renderDocument(template: string, publicBaseUrl: string, metadata: PageMetadata, page: React.ReactNode, data = "", structuredData = ""): string {
  return renderTemplate(template, publicBaseUrl, metadata, structuredData)
    .replace("<!--app-html-->", renderToString(<AppProviders>{page}</AppProviders>))
    .replace("<!--landing-data-->", data);
}

export function renderHomeDocument({ template, publicBaseUrl, popularBooks }: HomeDocumentInput): string {
  const data = { popularBooks };
  return renderDocument(template, publicBaseUrl, homePageMetadata, <LandingPage popularBooks={popularBooks} />, `<script id="landing-data" type="application/json">${serializeJson(data)}</script>`);
}

export function renderAboutDocument({ template, publicBaseUrl }: Omit<HomeDocumentInput, "popularBooks">): string {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: aboutFaqItems.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
  return renderDocument(template, publicBaseUrl, aboutPageMetadata, <AboutPage />, "", renderJsonLd(faqSchema));
}

export function renderPrivateSpaDocument({ template, publicBaseUrl }: Omit<HomeDocumentInput, "popularBooks">): string {
  return renderTemplate(template, publicBaseUrl, homePageMetadata)
    .replace("<!--app-html-->", "")
    .replace("<!--landing-data-->", "");
}
