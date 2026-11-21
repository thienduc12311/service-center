import { admin, sql, email, PW, SCR } from './lib.mjs';
import { writeFileSync } from 'node:fs';
const aliases = ['oa','l','k','u','g','s','kb','ob','x','oc','c1'];
const uid = {};
for (const a of aliases) {
  const { data, error } = await admin.auth.admin.createUser({ email: email(a), password: PW, email_confirm: true, user_metadata: { full_name: `QW9 ${a}` } });
  if (error) {
    if (/already/i.test(error.message)) {
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
      uid[a] = list.users.find((u) => u.email === email(a)).id;
      await admin.auth.admin.updateUserById(uid[a], { password: PW });
    } else throw error;
  } else uid[a] = data.user.id;
}
const org = {};
for (const [k, slug] of [['A','qa-w9-rt-a'],['B','qa-w9-rt-b'],['C','qa-w9-rt-c']]) {
  org[k] = sql(`insert into public.organizations (name, slug) values ('QA W9 RT ${k}', '${slug}') on conflict (slug) do update set name=excluded.name returning id;`).split('\n')[0];
}
const mem = (o, u, role) => sql(`insert into public.organization_members (organization_id,user_id,role,status) values ('${org[o]}','${uid[u]}','${role}','active') on conflict (organization_id,user_id) do update set role='${role}', status='active', access_mode='legacy';`);
const ppl = {};
const person = (o, u) => { ppl[`${o}:${u}`] = sql(`insert into public.people (organization_id, profile_id, first_name, last_name, email) select '${org[o]}','${uid[u]}','QW9','${u}','${email(u)}' where not exists (select 1 from public.people where organization_id='${org[o]}' and profile_id='${uid[u]}'); select id from public.people where organization_id='${org[o]}' and profile_id='${uid[u]}';`).split('\n').pop(); };
for (const u of ['oa']) mem('A', u, 'owner');
for (const u of ['l','k','u','g','s','kb']) mem('A', u, 'member');
mem('B','ob','owner'); mem('B','x','member'); mem('B','kb','member');
mem('C','oc','owner'); mem('C','c1','member');
for (const u of ['oa','l','k','u','g','s','kb']) person('A', u);
person('B','ob'); person('B','x'); person('B','kb'); person('C','oc'); person('C','c1');
writeFileSync(`${SCR}/fx.json`, JSON.stringify({ uid, org, ppl }, null, 1));
console.log(JSON.stringify({ org, members: sql(`select o.slug, count(*) from public.organization_members m join public.organizations o on o.id=m.organization_id where o.slug like 'qa-w9-rt-%' group by 1 order by 1;`), keys: sql(`select count(*) from private.org_realtime_keys k join public.organizations o on o.id=k.organization_id where o.slug like 'qa-w9-rt-%'`) }));
