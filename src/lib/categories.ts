export type Category = {
  id: string;
  label: string;
  family:
    | "home_services"
    | "auto"
    | "health"
    | "professional"
    | "hospitality"
    | "personal_care"
    | "community";
};

export const CATEGORIES: Category[] = [
  { id: "hvac", label: "HVAC", family: "home_services" },
  { id: "plumbing", label: "Plumbing", family: "home_services" },
  { id: "electrical", label: "Electrical", family: "home_services" },
  { id: "roofing", label: "Roofing", family: "home_services" },
  { id: "general_contractor", label: "General contractor", family: "home_services" },
  { id: "garage_door", label: "Garage door", family: "home_services" },
  { id: "pest_control", label: "Pest control", family: "home_services" },
  { id: "landscaping", label: "Landscaping", family: "home_services" },
  { id: "tree_service", label: "Tree service", family: "home_services" },
  { id: "cleaning", label: "House cleaning", family: "home_services" },
  { id: "painting", label: "Painting", family: "home_services" },
  { id: "flooring", label: "Flooring", family: "home_services" },
  { id: "windows_doors", label: "Windows and doors", family: "home_services" },
  { id: "solar", label: "Solar", family: "home_services" },
  { id: "pool_spa", label: "Pool and spa", family: "home_services" },
  { id: "auto_repair", label: "Auto repair", family: "auto" },
  { id: "auto_body", label: "Auto body", family: "auto" },
  { id: "dental", label: "Dental", family: "health" },
  { id: "chiropractic", label: "Chiropractic", family: "health" },
  { id: "medical_clinic", label: "Medical clinic", family: "health" },
  { id: "veterinary", label: "Veterinary", family: "health" },
  { id: "law_firm", label: "Law firm", family: "professional" },
  { id: "insurance", label: "Insurance", family: "professional" },
  { id: "real_estate", label: "Real estate", family: "professional" },
  { id: "restaurant", label: "Restaurant", family: "hospitality" },
  { id: "cafe", label: "Cafe", family: "hospitality" },
  { id: "salon", label: "Hair salon", family: "personal_care" },
  { id: "spa", label: "Spa", family: "personal_care" },
  { id: "gym", label: "Gym / fitness", family: "personal_care" },
  { id: "daycare", label: "Daycare", family: "community" },
  { id: "moving", label: "Moving", family: "home_services" },
  { id: "locksmith", label: "Locksmith", family: "home_services" },
  { id: "funeral", label: "Funeral home", family: "community" },
  { id: "church", label: "Church / house of worship", family: "community" },
];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

export function getCategory(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export function categoryLabel(id: string): string {
  if (!id.trim()) return "local business";
  return getCategory(id)?.label ?? id.replace(/[_-]+/g, " ").trim();
}

/** Keep known pack ids when they match; otherwise store the briefing’s own trade. */
export function normalizeCategory(raw: string | null | undefined): string {
  const t = (raw ?? "").trim().slice(0, 80);
  if (!t) return "local business";
  const lower = t.toLowerCase();
  const hit = CATEGORIES.find((c) => lower === c.id || lower === c.label.toLowerCase());
  return hit ? hit.id : t;
}
