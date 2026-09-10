// Shared types/helpers for the family-accounts model (Phase 4b).
//
// One login (`auth.users`) can manage several `family_members` rows — the
// people who actually receive care. A consultation always belongs to a
// family member, never directly to the login.

export interface FamilyMember {
  id: string;
  account_id: string;
  full_name: string;
  relationship: string;
  date_of_birth: string | null;
  attestation_confirmed: boolean;
  created_at: string;
}

export const RELATIONSHIPS = [
  { value: "spouse", label: "Spouse" },
  { value: "child", label: "Child" },
  { value: "parent", label: "Parent" },
  { value: "sibling", label: "Sibling" },
  { value: "other", label: "Other" },
] as const;

export const RELATIONSHIP_LABEL: Record<string, string> = {
  self: "You",
  spouse: "Spouse",
  child: "Child",
  parent: "Parent",
  sibling: "Sibling",
  other: "Other",
};

// Whole-years-old calculation from a YYYY-MM-DD date string. Used only to
// decide whether the attestation checkbox applies (Section 38 decision:
// adults need it, minor children added by a parent/guardian don't).
export function isAdultDob(dob: string): boolean {
  if (!dob) return false;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return false;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age >= 18;
}
