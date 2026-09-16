export type PopularBook = {
  title: string;
  author: string | null;
  description: string | null;
  coverUrl: string;
};

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
  popularBooks: PopularBook[];
  maintenanceStatus: LandingMaintenanceStatus;
  registrationStatus: LandingRegistrationStatus;
};
