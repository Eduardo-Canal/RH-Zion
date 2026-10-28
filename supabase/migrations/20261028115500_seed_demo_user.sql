-- Migration to create demo auth user and link to existing colaborador
DO $$
DECLARE
  v_user_id uuid;
  v_colaborador_id uuid;
  v_admin_perfil_id uuid;
BEGIN
  -- 1. Check if auth user already exists or create new
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'teste@adapta.org' LIMIT 1;

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      created_at,
      updated_at,
      raw_app_meta_data,
      raw_user_meta_data,
      is_super_admin,
      role,
      aud,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change,
      email_change_token_current,
      phone,
      phone_change,
      phone_change_token,
      reauthentication_token,
      is_sso_user,
      is_anonymous
    ) VALUES (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      'teste@adapta.org',
      crypt('Template@123', gen_salt('bf')),
      NOW(),
      NOW(),
      NOW(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      '{"name": "Administrador Demo", "nome": "Administrador Demo"}'::jsonb,
      false,
      'authenticated',
      'authenticated',
      '',
      '',
      '',
      '',
      '',
      NULL,
      '',
      '',
      '',
      false,
      false
    );
  ELSE
    -- If already exists, ensure email is confirmed and password is set to Template@123
    UPDATE auth.users
    SET
      encrypted_password = crypt('Template@123', gen_salt('bf')),
      email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
      raw_app_meta_data = COALESCE(raw_app_meta_data, '{"provider": "email", "providers": ["email"]}'::jsonb),
      updated_at = NOW()
    WHERE id = v_user_id;
  END IF;

  -- 2. Link colaborador "Administrador Demo" (teste@adapta.org) with this auth user
  UPDATE public.colaboradores
  SET user_id = v_user_id
  WHERE email = 'teste@adapta.org';

  -- 3. Also ensure public.profiles record exists if applicable (for full compatibility)
  SELECT id INTO v_admin_perfil_id FROM public.perfis_acesso WHERE nome = 'Administrador' LIMIT 1;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_user_id OR email = 'teste@adapta.org') THEN
    INSERT INTO public.profiles (
      user_id,
      nome,
      email,
      perfil_id,
      ativo,
      require_password_update
    ) VALUES (
      v_user_id,
      'Administrador Demo',
      'teste@adapta.org',
      v_admin_perfil_id,
      true,
      false
    );
  ELSE
    UPDATE public.profiles
    SET
      user_id = v_user_id,
      perfil_id = COALESCE(perfil_id, v_admin_perfil_id),
      ativo = true,
      require_password_update = false
    WHERE email = 'teste@adapta.org' OR user_id = v_user_id;
  END IF;

END $$;
