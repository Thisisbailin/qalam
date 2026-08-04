export type FountainTitlePage = {
  title: string;
  author: string;
  date: string;
  revision: string;
};

export const EMPTY_FOUNTAIN_TITLE_PAGE: FountainTitlePage = {
  title: "",
  author: "",
  date: "",
  revision: "",
};

const TITLE_PAGE_KEYS: Array<[keyof FountainTitlePage, string]> = [
  ["title", "Title"],
  ["author", "Author"],
  ["date", "Draft date"],
  ["revision", "Revision"],
];

const KEY_BY_LABEL = new Map(
  TITLE_PAGE_KEYS.map(([key, label]) => [label.toLowerCase(), key])
);

export const parseFountainTitlePage = (source: string): FountainTitlePage => {
  const fields = { ...EMPTY_FOUNTAIN_TITLE_PAGE };
  source.replace(/\r\n?/g, "\n").split("\n").forEach((line) => {
    const match = /^([^:]+):\s*(.*)$/.exec(line.trim());
    if (!match) return;
    const key = KEY_BY_LABEL.get(match[1].trim().toLowerCase());
    if (key) fields[key] = match[2].trim();
  });
  return fields;
};

export const serializeFountainTitlePage = (fields: FountainTitlePage) =>
  TITLE_PAGE_KEYS.flatMap(([key, label]) => {
    const value = fields[key].replace(/\s+/g, " ").trim();
    return value ? [`${label}: ${value}`] : [];
  }).join("\n");
