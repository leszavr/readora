import { useQuery } from "@tanstack/react-query";
import { LandingPage } from "@/components/LandingPage";
import type { PopularBook } from "@/landing-data";

export default function HomePage() {
  const { data: popularBooks = [] } = useQuery<PopularBook[]>({
    queryKey: ["popular-books"],
    queryFn: async () => {
      const res = await fetch("/api/public/popular-books?limit=6");
      if (!res.ok) return [];
      return res.json();
    },
  });

  return <LandingPage popularBooks={popularBooks} />;
}
