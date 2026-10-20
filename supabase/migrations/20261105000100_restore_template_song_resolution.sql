-- The structured-notices migration copied F10's preview body and replaced
-- F15's merged-song resolution. Preserve that new notice format while
-- restoring resolution of immutable template revisions at preview time.
do $$
declare
  definition text;
begin
  definition := pg_get_functiondef(
    'private.plan_template_preview(uuid,uuid,uuid,date,uuid,text,text[],jsonb,integer)'::regprocedure
  );
  if strpos(definition, 'v_content := private.canonical_song_content(v_rev.content);') > 0 then
    return;
  end if;
  if strpos(definition, 'v_content := v_rev.content;') = 0 then
    raise exception 'Template preview canonical resolution integration point missing';
  end if;
  execute replace(
    definition,
    'v_content := v_rev.content;',
    'v_content := private.canonical_song_content(v_rev.content);'
  );
end;
$$;
