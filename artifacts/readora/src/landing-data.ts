import type { CatalogShowcase as ApiCatalogShowcase, PublicCatalogEdition as ApiPublicCatalogEdition } from "@workspace/api-client-react";

export type PublicCatalogEdition = ApiPublicCatalogEdition;
export type CatalogShowcase = ApiCatalogShowcase;

export type LandingMaintenanceStatus = {
  enabled: boolean;
  reason: string | null;
  eta: string | null;
  message: string | null;
};

export type LandingRegistrationStatus = {
  enabled: boolean;
};

export type LandingData = {
  catalogShowcase: CatalogShowcase;
  maintenanceStatus: LandingMaintenanceStatus;
  registrationStatus: LandingRegistrationStatus;
};
