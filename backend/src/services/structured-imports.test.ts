import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  process.env.NODE_ENV='test'; process.env.SUPABASE_URL='http://localhost:54321';
  process.env.SUPABASE_ANON_KEY='test-anon-key-that-is-long-enough'; process.env.SUPABASE_SERVICE_ROLE_KEY='test-service-role-key-that-is-long-enough';
});
import { previewStructuredImport, stableJson } from './structured-imports.js';
import type { Db } from '../lib/supabase.js';
import { importPreviewRequestSchema, type ImportContextRow, type ImportPreviewRequest } from '@service-center/shared';
const owner = { organizationId:'aaaaaaaa-0000-4000-8000-000000000001',userId:'22222222-2222-4222-8222-222222222222' };
const id='33333333-3333-4333-8333-333333333333';
const candidate={id,label:'Existing Person',version:'version-1',archived:false,data:{first_name:'Existing',last_name:'Person',email:'same@example.com'}};
const source=(patch: Partial<ImportPreviewRequest> = {}): ImportPreviewRequest => importPreviewRequestSchema.parse({
 kind:'people',filename:'test.csv',content_type:'text/csv',content:'First,Email\nNew,SAME@example.com',mapping:{first_name:'First',email:'Email'},resolutions:[],...patch,
});
const db=(context: ImportContextRow[]): Db => ({rpc:vi.fn().mockResolvedValue({data:context,error:null})}) as unknown as Db;
describe('read-only structured import preview',()=>{
 it('normalizes email and refuses to auto-match an existing Person by email',async()=>{
  const client=db([{row:2,candidates:[candidate],candidate_count:1}]);
  const result=await previewStructuredImport(client,owner,source());
  expect(result.rows[0]).toMatchObject({action:'unresolved',data:{email:'same@example.com'},target_id:null});
  expect(result.can_commit).toBe(false);
  expect(client.rpc).toHaveBeenCalledExactlyOnceWith('structured_import_context',expect.any(Object));
 });
 it('updates an explicitly selected stable Person, with no profile fields',async()=>{
  const result=await previewStructuredImport(db([{row:2,candidates:[candidate],candidate_count:1}]),owner,source({resolutions:[{row:2,action:'update',target_id:id}]}));
  expect(result.can_commit).toBe(true);
  expect(result.rows[0]).toMatchObject({action:'update',target_id:id,expected_version:'version-1',before:candidate.data});
  expect(result.rows[0]!.data).not.toHaveProperty('profile_id');
 });
 it('requires resolution for duplicates within the CSV even without DB matches',async()=>{
  const input=source({content:'First,Email\nNew,same@example.com\nNew,same@example.com'});
  const result=await previewStructuredImport(db([{row:2,candidates:[],candidate_count:0},{row:3,candidates:[],candidate_count:0}]),owner,input);
  expect(result.rows.map(r=>r.action)).toEqual(['unresolved','unresolved']);
 });
 it('shows invalid rows, allows explicit skip, and rejects missing/foreign targets',async()=>{
  const invalid=source({content:'First,Email\nNew,not-email'});
  const context=[{row:2,candidates:[],candidate_count:0}];
  expect((await previewStructuredImport(db(context),owner,invalid)).rows[0]!.action).toBe('error');
  expect((await previewStructuredImport(db(context),owner,{...invalid,resolutions:[{row:2,action:'skip'}]})).rows[0]).toMatchObject({action:'skip',data:{},errors:[]});
  expect((await previewStructuredImport(db(context),owner,source({resolutions:[{row:2,action:'update',target_id:id}]}))).rows[0]!.errors).toContain('Target is unavailable in this organization');
 });
 it('keeps unmapped fields absent on updates and creates ordinary song defaults',async()=>{
  const input=source({kind:'songs',content:'ID,Tempo,Tags\n'+id+',80,Hope; Hope ;Advent',mapping:{id:'ID',default_bpm:'Tempo',themes:'Tags'}});
  const result=await previewStructuredImport(db([{row:2,candidates:[{...candidate,data:{title:'Song',default_bpm:70}}],candidate_count:1}]),owner,input);
  expect(result.rows[0]!.data).toEqual({default_bpm:80,themes:['Hope','Advent']});
  expect(result.can_commit).toBe(true);
  const create=await previewStructuredImport(db([{row:2,candidates:[],candidate_count:0}]),owner,source({kind:'songs',content:'Title\nHope',mapping:{title:'Title'}}));
  expect(create.rows[0]!.data).toMatchObject({title:'Hope',themes:[],song_types:[]});
 });
 it('binds the review hash to source, actor, organization, choices and target version',async()=>{
  const input=source({resolutions:[{row:2,action:'update',target_id:id}]});
  const context=[{row:2,candidates:[candidate],candidate_count:1}];
  const a=await previewStructuredImport(db(context),owner,input);
  const b=await previewStructuredImport(db(context),owner,input);
  expect(a.preview_hash).toBe(b.preview_hash);
  const c=await previewStructuredImport(db([{row:2,candidates:[{...candidate,version:'version-2'}],candidate_count:1}]),owner,input);
  expect(c.preview_hash).not.toBe(a.preview_hash);
  expect(stableJson({b:1,a:2})).toBe(stableJson({a:2,b:1}));
 });
 it('rejects missing mappings and row resolutions outside the file',async()=>{
  await expect(previewStructuredImport(db([]),owner,source({mapping:{first_name:'Missing'}}))).rejects.toMatchObject({status:422});
  await expect(previewStructuredImport(db([]),owner,source({resolutions:[{row:3,action:'skip'}]}))).rejects.toMatchObject({status:422});
 });
});
