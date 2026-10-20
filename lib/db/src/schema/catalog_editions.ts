import { boolean, index, integer, pgEnum, pgTable, serial, timestamp } from "drizzle-orm/pg-core";
import { booksTable } from "./books";
import { genresTable } from "./genres";
import { usersTable } from "./users";

export const catalogEditionStatusEnum = pgEnum("catalog_edition_status", ["draft", "published", "hidden", "withdrawn"]);

export const catalogEditionsTable = pgTable(
  "catalog_editions",
  {
    id: serial("id").primaryKey(),
    sourceBookId: integer("source_book_id").notNull().unique().references(() => booksTable.id, { onDelete: "restrict" }),
    status: catalogEditionStatusEnum("status").notNull().default("draft"),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    primaryGenreId: integer("primary_genre_id").references(() => genresTable.id, { onDelete: "set null" }),
    isLandingFeatured: boolean("is_landing_featured").notNull().default(false),
    landingFeaturedSortOrder: integer("landing_featured_sort_order").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("catalog_editions_status_published_at_idx").on(t.status, t.publishedAt),
    index("catalog_editions_featured_sort_order_idx").on(t.isLandingFeatured, t.landingFeaturedSortOrder),
    index("catalog_editions_primary_genre_id_idx").on(t.primaryGenreId),
  ],
);

export const catalogGiftOffersTable = pgTable(
  "catalog_gift_offers",
  {
    id: serial("id").primaryKey(),
    catalogEditionId: integer("catalog_edition_id").notNull().unique().references(() => catalogEditionsTable.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    isPublished: boolean("is_published").notNull().default(true),
    availableFrom: timestamp("available_from", { withTimezone: true }),
    availableUntil: timestamp("available_until", { withTimezone: true }),
    autoGrantOnSignup: boolean("auto_grant_on_signup").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("catalog_gift_offers_active_sort_order_idx").on(t.isPublished, t.sortOrder),
  ],
);

export type CatalogEdition = typeof catalogEditionsTable.$inferSelect;
export type CatalogGiftOffer = typeof catalogGiftOffersTable.$inferSelect;
