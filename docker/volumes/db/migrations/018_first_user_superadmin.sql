-- Private deployment bootstrap: the first account becomes the installation owner.
-- The advisory transaction lock makes the first-user decision safe under concurrent signups.
CREATE OR REPLACE FUNCTION public.assign_first_user_superadmin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('readest:first-user-superadmin'));

  IF NOT EXISTS (SELECT 1 FROM auth.users) THEN
    NEW.raw_app_meta_data := COALESCE(NEW.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object(
      'role', 'superadmin',
      'plan', 'purchase',
      'storage_usage_bytes', 0,
      'storage_purchased_bytes', 0
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assign_first_user_superadmin ON auth.users;
CREATE TRIGGER assign_first_user_superadmin
BEFORE INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.assign_first_user_superadmin();

REVOKE ALL ON FUNCTION public.assign_first_user_superadmin()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_first_user_superadmin() TO supabase_auth_admin;
