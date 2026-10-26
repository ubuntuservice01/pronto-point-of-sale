-- Do not create rate-limit rows for arbitrary nonexistent phone numbers.
-- Only linked merchant phone aliases are throttled. Password validation stays in GoTrue.
create or replace function public.pronto_login_email_for_phone(p_phone text)
returns text language plpgsql security definer volatile set search_path='' as $$
declare v_phone text;v_attempts integer;v_email text;
begin
 v_phone:=pronto_private.normalize_mz_mobile(p_phone);
 if v_phone is null then return null;end if;
 select u.email into v_email from pronto_private.phone_login_aliases a
 join auth.users u on u.id=a.user_id where a.phone_e164=v_phone;
 if v_email is null then return null;end if;
 insert into pronto_private.phone_login_limits(phone_e164,window_started_at,attempts)
 values(v_phone,now(),1)
 on conflict(phone_e164) do update set
  attempts=case when pronto_private.phone_login_limits.window_started_at<now()-interval '15 minutes'
   then 1 else pronto_private.phone_login_limits.attempts+1 end,
  window_started_at=case when pronto_private.phone_login_limits.window_started_at<now()-interval '15 minutes'
   then now() else pronto_private.phone_login_limits.window_started_at end
 returning attempts into v_attempts;
 if v_attempts>10 then raise exception 'too_many_attempts' using errcode='P0001';end if;
 return v_email;
end;$$;
revoke all on function public.pronto_login_email_for_phone(text) from public,anon,authenticated;
grant execute on function public.pronto_login_email_for_phone(text) to service_role;