-- W8-INT-D1: Postgres least(NULL, 86400) = 86400, so a retry without Retry-After
-- waited ~24h. A missing Retry-After counts as 0; otherwise clamp to [0, 86400].
create or replace function public.complete_webhook_delivery(
  p_delivery             uuid,
  p_attempt              int,
  p_outcome              text,
  p_status_code          int,
  p_error_code           text,
  p_started_at           timestamptz,
  p_duration_ms          int,
  p_retry_after_seconds  int
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_del     public.webhook_deliveries%rowtype;
  v_final   text;
  v_backoff int[] := array[5, 300, 1800, 7200, 18000, 36000, 50400, 72000];
  v_delay   int;
begin
  if p_outcome not in ('succeeded', 'retry', 'failed', 'gone') then
    raise exception 'Unknown outcome' using errcode = '22023';
  end if;
  select * into v_del from public.webhook_deliveries
   where id = p_delivery and status = 'sending' and attempts = p_attempt
   for update;
  if v_del.id is null then
    return 'stale';
  end if;

  insert into public.webhook_delivery_attempts
    (delivery_id, organization_id, attempt, started_at, duration_ms, status_code, outcome, error_code)
  values
    (v_del.id, v_del.organization_id, p_attempt, p_started_at, p_duration_ms, p_status_code, p_outcome, p_error_code)
  on conflict on constraint webhook_delivery_attempts_once do nothing;

  v_final := case
    when p_outcome = 'succeeded' then 'succeeded'
    when p_outcome = 'retry' and v_del.attempts < v_del.max_attempts then 'queued'
    else 'failed' end;
  v_delay := greatest(
    case when p_retry_after_seconds is null then 0
         else least(greatest(p_retry_after_seconds, 0), 86400) end,
    v_backoff[least(v_del.attempts, array_length(v_backoff, 1))]);

  update public.webhook_deliveries
     set status = v_final,
         lease_expires_at = null,
         last_status_code = p_status_code,
         last_error_code = case when v_final = 'succeeded' then null else p_error_code end,
         next_attempt_at = case when v_final = 'queued'
                                then now() + make_interval(secs => v_delay * (0.9 + random() * 0.2))
                                else next_attempt_at end,
         completed_at = case when v_final = 'queued' then null else now() end
   where id = v_del.id;

  if v_final = 'succeeded' then
    update public.webhook_endpoints set consecutive_failures = 0
     where id = v_del.endpoint_id and consecutive_failures <> 0;
  elsif p_outcome = 'gone' then
    update public.webhook_endpoints
       set enabled = false, disabled_reason = 'gone', revision = revision + 1
     where id = v_del.endpoint_id and enabled;
  elsif v_final = 'failed' then
    update public.webhook_endpoints
       set consecutive_failures = consecutive_failures + 1,
           enabled = case when consecutive_failures + 1 >= 5 then false else enabled end,
           disabled_reason = case when consecutive_failures + 1 >= 5 and enabled then 'failing' else disabled_reason end,
           revision = revision + 1
     where id = v_del.endpoint_id;
  end if;
  return v_final;
end;
$$;
revoke execute on function public.complete_webhook_delivery(uuid, int, text, int, text, timestamptz, int, int) from public, anon, authenticated;
grant execute on function public.complete_webhook_delivery(uuid, int, text, int, text, timestamptz, int, int) to service_role;
