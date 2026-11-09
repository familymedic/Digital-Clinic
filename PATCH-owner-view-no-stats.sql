-- Only needed if you ALREADY ran the first 0096 file: it removes the statistics from the owner's page data.
-- If you have not run 0096 yet, ignore this file (the new 0096 already contains it).
create or replace function public.locator_manage_view(p_hash text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p public.locator_places%rowtype;
  f public.locator_fees%rowtype;
begin
  if p_hash is null or char_length(p_hash) <> 64 then return null; end if;
  select * into p from public.locator_places where manage_token_hash = p_hash;
  if not found then return null; end if;
  select * into f from public.locator_fees where kind = p.kind;
  return jsonb_build_object(
    'id', p.id, 'name', p.name, 'kind', p.kind, 'category', p.category, 'area', p.area,
    'status', p.status, 'verification_status', p.verification_status,
    'rejection_reason', p.rejection_reason, 'paid_until', p.paid_until,
    'fee_pkr', coalesce(f.fee_pkr, 0), 'requires_verification', coalesce(f.requires_verification, true),
    'live', (p.status = 'approved' and p.paid_until is not null and p.paid_until > now()),
    'phone_verified', p.phone_verified
    -- no view/tap numbers here on purpose: those are for the admin only
  );
end;
$$;
