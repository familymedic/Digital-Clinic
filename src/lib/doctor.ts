// Shared types/helpers for the doctor side of the platform (Phase 7,
// step 1). A doctor account is a normal Supabase Auth account (same
// auth.users table patients use) that also has a matching row in
// `doctor_profiles`. There is no separate auth system — just a separate
// front door (/doctor/login) and this membership check.

export interface DoctorProfile {
  id: string;
  full_name: string;
  created_at: string;
}
