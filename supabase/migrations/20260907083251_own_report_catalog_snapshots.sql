-- Capture the public reference actually used by new own-report generation.
-- Additive: old application completions without a snapshot remain readable;
-- no historical result is decorated from today's catalog or backfilled.
create function private.capture_own_report_catalog_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,private as $function$
declare item jsonb; captured jsonb; expected jsonb; reports jsonb:='[]'::jsonb;
begin
 if new.state<>'complete' then return new; end if;
 if tg_op='UPDATE' and old.state='complete' then
  if new.result is distinct from old.result then
   raise exception using errcode='55000',message='completed_report_is_immutable';
  end if;
  return new;
 end if;
 if jsonb_typeof(new.result->'reports') is distinct from 'array' then
  raise exception using errcode='22023',message='invalid_report_catalog';
 end if;
 -- Match completion against stable references. A catalog edit between the
 -- application's read and this lock causes failure, never a false revision.
 perform t.slug from public.report_templates t
  where exists(select 1 from jsonb_array_elements(new.result->'reports') x
   where x ? 'catalogSnapshot' and t.slug=x->>'slug')
  order by t.slug for share;
 for item in select value from jsonb_array_elements(new.result->'reports') loop
  if item ? 'catalogSnapshot' then
   captured:=item->'catalogSnapshot';
   if jsonb_typeof(captured) is distinct from 'object'
    or captured->'schemaVersion' is distinct from '1'::jsonb
    or not(captured ?& array['schemaVersion','template'])
    or captured-array['schemaVersion','template']<>'{}'::jsonb then
    raise exception using errcode='22023',message='invalid_report_catalog';
   end if;
   select jsonb_build_object('slug',t.slug,'category',t.category,'title',t.title,'summary',t.summary,
    'evidence',t.evidence,'variants',t.variants,'pgs_id',t.pgs_id,'citations',t.citations,
    'layer',t.layer,'estimate_kind',t.estimate_kind) into expected
    from public.report_templates t where t.slug=item->>'slug' and t.status='published'
     and t.layer::text=case new.purpose when 'reports.monogenic' then 'variant_call'
      when 'reports.polygenic' then 'estimate' else null end;
   if expected is null or captured->'template' is distinct from expected then
    raise exception using errcode='22023',message='invalid_report_catalog';
   end if;
   item:=jsonb_set(item,'{catalogSnapshot,templateSha256}',
    to_jsonb(encode(extensions.digest(convert_to(expected::text,'UTF8'),'sha256'),'hex')));
  end if;
  reports:=reports||jsonb_build_array(item);
 end loop;
 new.result:=jsonb_set(new.result,'{reports}',reports);
 if octet_length(new.result::text)>4000000 then
  raise exception using errcode='22023',message='invalid_report_catalog';
 end if;
 return new;
end;
$function$;
revoke all on function private.capture_own_report_catalog_v1() from public,anon,authenticated,inherit_upload_only;
create trigger capture_own_report_catalog_v1 before insert or update on private.own_analysis_runs
 for each row execute function private.capture_own_report_catalog_v1();
