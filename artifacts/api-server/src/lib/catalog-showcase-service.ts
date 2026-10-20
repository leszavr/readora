import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { bookGenresTable, booksTable, catalogEditionsTable, db, genresTable } from "@workspace/db";

type PublicCatalogEdition = {
  title: string;
  author: string | null;
  description: string | null;
  coverUrl: string | null;
  genres: string[];
  publicationYear: number | null;
};

type ShowcaseRow = {
  edition: typeof catalogEditionsTable.$inferSelect;
  book: typeof booksTable.$inferSelect;
};

async function getGenreNamesBySourceBookIds(sourceBookIds: number[]): Promise<Map<number, string[]>> {
  if (sourceBookIds.length === 0) return new Map();

  const rows = await db
    .select({ bookId: bookGenresTable.bookId, name: genresTable.name })
    .from(bookGenresTable)
    .innerJoin(genresTable, eq(bookGenresTable.genreId, genresTable.id))
    .where(inArray(bookGenresTable.bookId, sourceBookIds));

  const genreNamesBySourceBookId = new Map<number, string[]>();
  for (const row of rows) {
    genreNamesBySourceBookId.set(row.bookId, [...(genreNamesBySourceBookId.get(row.bookId) ?? []), row.name]);
  }
  return genreNamesBySourceBookId;
}

async function formatPublicEditions(rows: ShowcaseRow[]): Promise<PublicCatalogEdition[]> {
  const genreNamesBySourceBookId = await getGenreNamesBySourceBookIds(rows.map(({ book }) => book.id));

  return rows.map(({ edition, book }) => ({
    title: book.title,
    author: book.author,
    description: book.description,
    coverUrl: book.coverPath ? `/api/public/catalog-editions/${edition.id}/cover?v=${book.updatedAt.getTime()}` : null,
    genres: genreNamesBySourceBookId.get(book.id) ?? [],
    publicationYear: book.publicationYear,
  }));
}

export async function getCatalogShowcase(): Promise<{ featured: PublicCatalogEdition[]; recent: PublicCatalogEdition[] }> {
  const baseConditions = and(
    eq(catalogEditionsTable.status, "published"),
    eq(booksTable.status, "active"),
    eq(booksTable.scope, "catalog_source"),
  );
  const [featuredRows, recentRows] = await Promise.all([
    db
      .select({ edition: catalogEditionsTable, book: booksTable })
      .from(catalogEditionsTable)
      .innerJoin(booksTable, eq(catalogEditionsTable.sourceBookId, booksTable.id))
      .where(and(baseConditions, eq(catalogEditionsTable.isLandingFeatured, true)))
      .orderBy(asc(catalogEditionsTable.landingFeaturedSortOrder), asc(catalogEditionsTable.id))
      .limit(4),
    db
      .select({ edition: catalogEditionsTable, book: booksTable })
      .from(catalogEditionsTable)
      .innerJoin(booksTable, eq(catalogEditionsTable.sourceBookId, booksTable.id))
      .where(and(baseConditions, eq(catalogEditionsTable.isLandingFeatured, false), sql`${catalogEditionsTable.publishedAt} is not null`))
      .orderBy(desc(catalogEditionsTable.publishedAt), desc(catalogEditionsTable.id))
      .limit(8),
  ]);
  const [featured, recent] = await Promise.all([formatPublicEditions(featuredRows), formatPublicEditions(recentRows)]);

  return { featured, recent };
}
