type GenreLike = {
  id: number;
  code: string;
  name: string;
  isActive?: boolean | null;
};

const GENRE_TOKEN_SEPARATORS = /[;,|/\\>]+/g;

const TOKEN_TO_GENRE_CODE: Record<string, string> = {
  "action": "adventure",
  "adventure": "adventure",
  "adventures": "adventure",
  "adv_animal": "adventure",
  "adv_geo": "adventure",
  "adv_history": "historical",
  "adv_indian": "adventure",
  "adv_maritime": "adventure",
  "adv_modern": "adventure",
  "adv_western": "adventure",
  "biography": "biography",
  "business": "business",
  "bus_career": "business",
  "bus_economics": "business",
  "bus_marketing": "business",
  "children": "children",
  "child_adv": "children",
  "child_det": "children",
  "child_education": "children",
  "child_prose": "children",
  "child_sf": "children",
  "child_tale": "children",
  "classic": "fiction",
  "comedy": "humor",
  "comp_db": "education",
  "comp_hard": "education",
  "comp_osnet": "education",
  "comp_programming": "education",
  "comp_soft": "education",
  "comp_www": "education",
  "computers": "education",
  "detective": "detective",
  "det_action": "detective",
  "det_classic": "detective",
  "det_crime": "detective",
  "det_espionage": "detective",
  "det_hard": "detective",
  "det_history": "detective",
  "det_irony": "detective",
  "det_maniac": "thriller",
  "det_police": "detective",
  "det_political": "detective",
  "det_thriller": "thriller",
  "drama": "drama",
  "dramaturgy": "drama",
  "education": "education",
  "essay": "nonfiction",
  "fantasy": "fantasy",
  "fiction": "fiction",
  "home": "nonfiction",
  "home_cooking": "nonfiction",
  "home_crafts": "nonfiction",
  "home_diy": "nonfiction",
  "home_entertain": "nonfiction",
  "home_garden": "nonfiction",
  "home_health": "nonfiction",
  "home_pets": "nonfiction",
  "home_sport": "nonfiction",
  "horror": "horror",
  "humor": "humor",
  "humor_anecdote": "humor",
  "humor_prose": "humor",
  "humor_verse": "humor",
  "love": "romance",
  "love_contemporary": "romance",
  "love_detective": "romance",
  "love_erotica": "romance",
  "love_history": "romance",
  "love_sf": "romance",
  "non-fiction": "nonfiction",
  "nonfiction": "nonfiction",
  "poetry": "poetry",
  "prose_classic": "fiction",
  "prose_contemporary": "fiction",
  "prose_history": "historical",
  "prose_military": "historical",
  "prose_rus_classic": "fiction",
  "prose_su_classics": "fiction",
  "psychology": "psychology",
  "ref_dict": "education",
  "ref_encyc": "education",
  "ref_guide": "education",
  "reference": "education",
  "religion": "nonfiction",
  "romance": "romance",
  "sci_biology": "science",
  "sci_chem": "science",
  "sci_history": "science",
  "sci_juris": "science",
  "sci_linguistic": "science",
  "sci_math": "science",
  "sci_medicine": "science",
  "sci_phys": "science",
  "sci_politics": "science",
  "sci_psychology": "psychology",
  "sci_religion": "nonfiction",
  "sci_tech": "science",
  "science": "science",
  "science fiction": "science_fiction",
  "sci-fi": "science_fiction",
  "sf": "science_fiction",
  "sf_action": "science_fiction",
  "sf_cyberpunk": "science_fiction",
  "sf_detective": "science_fiction",
  "sf_epic": "science_fiction",
  "sf_fantasy": "fantasy",
  "sf_heroic": "science_fiction",
  "sf_history": "science_fiction",
  "sf_horror": "horror",
  "sf_humor": "humor",
  "sf_postapocalyptic": "science_fiction",
  "sf_social": "science_fiction",
  "sf_space": "science_fiction",
  "short story": "fiction",
  "thriller": "thriller",
  "young adult": "children",
  "биография": "biography",
  "бизнес": "business",
  "детектив": "detective",
  "детская литература": "children",
  "драма": "drama",
  "историческая проза": "historical",
  "история": "historical",
  "научная фантастика": "science_fiction",
  "наука": "science",
  "нон фикшн": "nonfiction",
  "нон-фикшн": "nonfiction",
  "образование": "education",
  "поэзия": "poetry",
  "приключения": "adventure",
  "проза": "fiction",
  "психология": "psychology",
  "роман": "fiction",
  "романтика": "romance",
  "триллер": "thriller",
  "ужасы": "horror",
  "фантастика": "science_fiction",
  "фэнтези": "fantasy",
  "юмор": "humor",
};

export function normalizeGenreToken(raw: string): string {
  return raw
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[_-]+/g, " ")
    .replace(/[()[\]{}"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function expandGenreInput(input: string[]): string[] {
  return input
    .flatMap((value) => value.split(GENRE_TOKEN_SEPARATORS))
    .map((value) => value.trim())
    .filter(Boolean);
}

export function resolveGenreIds(input: string[], genres: GenreLike[]): number[] {
  const activeGenres = genres.filter((genre) => genre.isActive !== false);
  const byCode = new Map(activeGenres.map((genre) => [genre.code, genre]));
  const lookup = new Map<string, GenreLike>();

  for (const genre of activeGenres) {
    lookup.set(normalizeGenreToken(genre.code), genre);
    lookup.set(normalizeGenreToken(genre.name), genre);
  }

  const matchedIds: number[] = [];
  const seen = new Set<number>();

  for (const rawToken of expandGenreInput(input)) {
    const normalized = normalizeGenreToken(rawToken);
    const mappedCode = TOKEN_TO_GENRE_CODE[rawToken.trim().toLowerCase()] ?? TOKEN_TO_GENRE_CODE[normalized];
    const genre = (mappedCode ? byCode.get(mappedCode) : null) ?? lookup.get(normalized);
    if (!genre || seen.has(genre.id)) continue;

    seen.add(genre.id);
    matchedIds.push(genre.id);
  }

  return matchedIds;
}
