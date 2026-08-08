export type PopularBook = {
  title: string;
  author: string | null;
  description: string | null;
  coverUrl: string;
};

export type LandingData = {
  popularBooks: PopularBook[];
};
