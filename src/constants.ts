export const TENNIS_CENTERS = [
  { id: "12", name: "אופקים", nameEn: "Ofakim" },
  { id: "8", name: "אשקלון", nameEn: "Ashkelon" },
  { id: "11", name: "באר שבע", nameEn: "Beer Sheva" },
  { id: "40", name: "דימונה", nameEn: "Dimona" },
  { id: "5", name: "חיפה", nameEn: "Haifa" },
  { id: "9", name: "טבריה", nameEn: "Tiberias" },
  { id: "3", name: "יפו", nameEn: "Jaffa" },
  { id: "14", name: "יקנעם", nameEn: "Yokneam" },
  { id: "7", name: "ירושלים", nameEn: "Jerusalem" },
  { id: "46", name: "כוכב יאיר", nameEn: "Kochav Yair" },
  { id: "37", name: "נהריה", nameEn: "Nahariya" },
  { id: "15", name: "סאג'ור", nameEn: "Sajur" },
  { id: "16", name: "עכו", nameEn: "Acre" },
  { id: "6", name: "ערד", nameEn: "Arad" },
  { id: "10", name: "קרית אונו", nameEn: "Kiryat Ono" },
  { id: "4", name: "קרית שמונה", nameEn: "Kiryat Shmona" },
  { id: "2", name: "רמת השרון", nameEn: "Ramat Hasharon" },
  { id: "13", name: "תל אביב (יד אליהו)", nameEn: "Tel Aviv (Yad Eliyahu)" },
];

export const COURT_TYPE = "1"; // Always 1 for tennis courts

export const DURATIONS = [1, 1.5, 2, 3] as const;

export type Duration = (typeof DURATIONS)[number];

export const BASE_URL = "https://center.tennis.org.il";
