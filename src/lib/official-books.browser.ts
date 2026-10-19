import { loadOfficialBooks } from "./official-books.server";

export { OFFICIAL, type OfficialBid, type OfficialBooks, type OfficialList } from "./official-books";

export function getOfficialBooks() {
  return loadOfficialBooks();
}
