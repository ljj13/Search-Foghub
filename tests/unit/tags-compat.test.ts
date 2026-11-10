import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defaults, preferencesSchema } from '../../src/shared/preferences';

// SPEC ONLY. This file pins down the proposed v3 schema from docs/TAGS-PLAN.md §3.1; nothing here
// touches src/, the Worker or the served bundle. The v3 schema lives locally on purpose: production
// still reads and writes v2, so it must stay a strict superset of the document below.
//
// Why a local copy instead of an import: v3 must never silently drift away from v2 (same folder and
// shortcut limits, same URL rules, same defaults). The parity test at the bottom fails the moment the
// two disagree, which is the only automated guard we have while the feature is unshipped.
export const tagColors = ['slate','blue','cyan','green','amber','rose','violet','pink'] as const;
// Names may be shown as chips and may end up in a filter URL, so characters that would need escaping
// there are rejected instead of percent-encoded later.
const tagName = z.string().trim().min(1).max(12).refine(s => !/[/%\\?#:\u0000-\u001f]/.test(s) && s !== '.' && s !== '..');
const tagId = z.string().min(1).max(36);   // crypto.randomUUID() is 36 chars; the cap keeps the worst-case payload under readJson
export const tagSchema = z.object({
  id: tagId,
  name: tagName,
  color: z.enum(tagColors).default('slate'),
}).strict();
// One shortcut may carry several tags; duplicates inside that list are meaningless and rejected here
// rather than deduplicated, because a silent fixup would hide an editor bug.
export const tagIds = z.array(tagId).max(6).default([]).refine(list => new Set(list).size === list.length);
export const shortcutSchemaV3 = z.object({
  id: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(40),
  folderId: z.string().min(1).max(64).nullable().default(null),
  url: z.url().max(2048).refine(s => { const u = new URL(s); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; }),
  tags: tagIds,
}).strict();
const folderSchemaV3 = z.object({id: z.string().min(1).max(64), name: z.string().trim().min(1).max(24), icon: z.enum(['auto','folder','mail','briefcase','book','shopping','play','tools','code','star','heart']).default('auto')}).strict();
const wallpaperSchemaV3 = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('builtin'), id: z.enum(['alpine-mist','cloud-peaks','winter-light'])}).strict(),
  z.object({kind: z.literal('webdav'), file: z.string().min(1).max(255).refine(s => !/[/%\\\u0000-\u001f:#?]/.test(s) && s !== '.' && s !== '..')}).strict(),
]);
// A folder stays the primary membership; tags are secondary labels. Both are validated in the same
// document so one CAS version covers folder, shortcut and tag edits atomically.
export const preferencesSchemaV3 = z.object({
  shortcutLayout: z.enum(['flat','folders']).default('flat'),
  folders: z.array(folderSchemaV3).max(20).default([]),
  tags: z.array(tagSchema).max(30).default([]),
  engine: z.enum(['google', 'bing', 'baidu']), newTab: z.boolean(),
  wallpaper: wallpaperSchemaV3,
  dim: z.number().min(0.15).max(0.7),
  shortcuts: z.array(shortcutSchemaV3).max(100).refine(s => new Set(s.map(x => x.id)).size === s.length),
}).strict().superRefine((data, ctx) => {
  const folderIds = new Set(data.folders.map(f => f.id));
  if (folderIds.size !== data.folders.length) ctx.addIssue({code:'custom', path:['folders'], message:'文件夹 ID 重复'});
  const ids = new Set(data.tags.map(t => t.id));
  if (ids.size !== data.tags.length) ctx.addIssue({code:'custom', path:['tags'], message:'标签 ID 重复'});
  const names = new Set(data.tags.map(t => t.name.toLowerCase()));
  if (names.size !== data.tags.length) ctx.addIssue({code:'custom', path:['tags'], message:'标签名称重复'});
  for (const [i, s] of data.shortcuts.entries()) {
    if (s.folderId !== null && !folderIds.has(s.folderId)) ctx.addIssue({code:'custom', path:['shortcuts', i, 'folderId'], message:'文件夹不存在'});
    for (const [j, id] of s.tags.entries()) if (!ids.has(id)) ctx.addIssue({code:'custom', path:['shortcuts', i, 'tags', j], message:'标签不存在'});
  }
});

type Doc = Record<string, unknown>;
// A v2 document: exactly what today's client PUTs and what today's rows contain.
const v2Doc: Doc = { ...defaults, folders: [{ id: 'work', name: '工作' }], shortcutLayout: 'folders',
  shortcuts: defaults.shortcuts.map((s, i) => ({ ...s, folderId: i === 0 ? 'work' : null })) };
const tag = (id: string, name = id) => ({ id, name, color: 'blue' as const });
const site = (id: string, tags: string[], folderId: string | null = null) => ({ id, title: id, url: `https://${id}.example/`, folderId, tags });
// A v3 document: the same sites plus two tags and a couple of assignments.
const v3Doc: Doc = { ...v2Doc, tags: [tag('t-work', '工作'), tag('t-read', '阅读')],
  shortcuts: defaults.shortcuts.map((s, i) => ({ ...s, folderId: i === 0 ? 'work' : null, tags: i < 2 ? ['t-work'] : [] })) };
// Build a document whose tag list is the only varying part: every shortcut reference is cleared first,
// otherwise an unrelated dangling reference would make the assertion pass for the wrong reason.
const withTags = (tags: unknown[], shortcuts: unknown[] = [site('s0', [])]): Doc => ({ ...v3Doc, tags, shortcuts });
const withoutTopLevelTags = (doc: Doc) => { const copy = { ...doc }; delete copy.tags; return copy; };
const many = (n: number) => Array.from({ length: n }, (_, i) => tag(`t${i}`, `标${i}`));

describe('tags v3 compatibility', () => {
  it('upgrades v2 data with empty tag lists and keeps shortcuts, folders and layout intact', () => {
    const parsed = preferencesSchemaV3.parse(v2Doc);
    expect(parsed.tags).toEqual([]);
    expect(parsed.shortcuts.every(s => s.tags.length === 0)).toBe(true);
    expect(parsed.shortcutLayout).toBe('folders');
    expect(parsed.folders).toEqual([{ id: 'work', name: '工作', icon: 'auto' }]);
    expect(parsed.shortcuts.map(s => s.id)).toEqual(defaults.shortcuts.map(s => s.id));
    expect(parsed.shortcuts[0].folderId).toBe('work');
  });

  it('shows that v2 cannot read v3 data, so the Worker must serve a versioned projection', () => {
    // issues carry zod's own order (nested shortcuts are parsed before the outer object's key check),
    // so the assertion looks for the paths that must be present rather than for issues[0].
    const paths = (result: ReturnType<typeof preferencesSchema.safeParse>) =>
      result.success ? [] : result.error.issues.map(i => ({ code: i.code, path: i.path }));
    const top = preferencesSchema.safeParse(v3Doc);
    expect(top.success).toBe(false);
    expect(paths(top)).toContainEqual({ code: 'unrecognized_keys', path: [] });
    expect(paths(top)).toContainEqual({ code: 'unrecognized_keys', path: ['shortcuts', 0] });
    // Even after the top-level field is gone, every shortcut still carries tags: v2 rejects those too.
    const deep = preferencesSchema.safeParse(withoutTopLevelTags(v3Doc));
    expect(deep.success).toBe(false);
    expect(paths(deep)).toContainEqual({ code: 'unrecognized_keys', path: ['shortcuts', 0] });
    // The very same document is valid for v3, so the failure is a schema-version mismatch, not bad data.
    expect(preferencesSchemaV3.parse(v3Doc).tags.map(t => t.id)).toEqual(['t-work', 't-read']);
  });

  it('rejects dangling references, duplicate ids, duplicate names and repeated ids on one shortcut', () => {
    // A tag removed without stripping its assignments would make the whole document unsavable.
    expect(() => preferencesSchemaV3.parse({ ...v3Doc, shortcuts: [site('s0', ['t-gone'])] })).toThrow();
    // Same id twice in the tag list, even with a different name.
    expect(() => preferencesSchemaV3.parse({ ...v3Doc, tags: [tag('t-work', '工作'), tag('t-work', '杂务')] })).toThrow();
    // Same name twice, compared after trimming and lowercasing.
    expect(() => preferencesSchemaV3.parse({ ...v3Doc, tags: [tag('t-work', '工作'), tag('t-read', ' 工作 ')] })).toThrow();
    // Duplicates inside one shortcut.tags are rejected rather than silently collapsed.
    expect(() => preferencesSchemaV3.parse({ ...v3Doc, shortcuts: [site('s0', ['t-work', 't-work'])] })).toThrow();
    // A valid assignment still parses, so the rejections above are not just "anything with tags fails".
    expect(preferencesSchemaV3.parse({ ...v3Doc, shortcuts: [site('s0', ['t-work', 't-read'])] }).shortcuts[0].tags).toEqual(['t-work', 't-read']);
  });

  it('bounds tag names by length and rejects blank, percent and reserved names', () => {
    const named = (name: string) => preferencesSchemaV3.parse(withTags([tag('t1', name)])).tags[0].name;
    expect(named('标'.repeat(12))).toBe('标'.repeat(12));
    expect(() => named('标'.repeat(13))).toThrow();
    expect(named('  工作  ')).toBe('工作');
    expect(() => named('   ')).toThrow();
    expect(() => named('')).toThrow();
    expect(() => named('100%')).toThrow();
    expect(() => named('工作#1')).toThrow();
    expect(() => named('.')).toThrow();
  });

  it('bounds tag counts per document and per shortcut while the folder and shortcut caps still hold', () => {
    expect(preferencesSchemaV3.parse(withTags(many(30))).tags).toHaveLength(30);
    expect(() => preferencesSchemaV3.parse(withTags(many(31)))).toThrow();
    const six = ['t0', 't1', 't2', 't3', 't4', 't5'];
    expect(preferencesSchemaV3.parse(withTags(many(6), [site('s0', six)])).shortcuts[0].tags).toHaveLength(6);
    expect(() => preferencesSchemaV3.parse(withTags(many(7), [site('s0', [...six, 't6'])]))).toThrow();
    const sites = (n: number) => Array.from({ length: n }, (_, i) => site(`s${i}`, []));
    expect(preferencesSchemaV3.parse(withTags([], sites(100))).shortcuts).toHaveLength(100);
    expect(() => preferencesSchemaV3.parse(withTags([], sites(101)))).toThrow();
    const folders = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `f${i}`, name: `组${i}` }));
    expect(preferencesSchemaV3.parse({ ...withTags([]), folders: folders(20) }).folders).toHaveLength(20);
    expect(() => preferencesSchemaV3.parse({ ...withTags([]), folders: folders(21) })).toThrow();
    // The id cap is a payload budget, not cosmetics: 37 characters would exceed readJson at 100 sites.
    expect(preferencesSchemaV3.parse(withTags([tag('t'.repeat(36), '标')])).tags[0].id).toHaveLength(36);
    expect(() => preferencesSchemaV3.parse(withTags([tag('t'.repeat(37), '标')]))).toThrow();
  });

  it('defaults the tag color and rejects colors outside the palette', () => {
    expect(preferencesSchemaV3.parse(withTags([{ id: 't1', name: '工作' }])).tags[0].color).toBe('slate');
    expect(() => preferencesSchemaV3.parse(withTags([{ id: 't1', name: '工作', color: 'neon' }]))).toThrow();
  });

  it('keeps v2 and v3 in agreement on everything they both validate (drift guard)', () => {
    const docs: Doc[] = [
      { ...v2Doc, keywords: 1 },
      { ...v2Doc, shortcuts: [{ ...defaults.shortcuts[0], folderId: 'missing' }] },
      { ...v2Doc, shortcuts: [defaults.shortcuts[0], defaults.shortcuts[0]] },
      { ...v2Doc, shortcuts: [{ ...defaults.shortcuts[0], url: 'javascript:alert(1)' }] },
      { ...v2Doc, folders: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }] },
      { ...v2Doc, dim: 0.05 },
      { ...v2Doc, wallpaper: { kind: 'webdav', file: '../secret.jpg' } },
    ];
    for (const doc of docs) {
      expect(() => preferencesSchema.parse(doc)).toThrow();
      expect(() => preferencesSchemaV3.parse({ ...doc, tags: [] })).toThrow();
    }
    // And the other direction: a valid v2 document becomes a valid v3 document by adding tags.
    expect(preferencesSchemaV3.parse({ ...v2Doc, tags: [] }).shortcuts).toHaveLength(defaults.shortcuts.length);
  });
});
