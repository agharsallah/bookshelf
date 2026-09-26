import { describe, expect, it } from 'vitest';
import type { TreeNode } from '../../lib/api/types/documents';
import type { ChapterStatus } from '../../lib/documents/artifacts';
import { chapterBadge, contentsSummary, readLink } from './contents';

const unit = (anchor: string, meta: TreeNode['meta'] = {}) => ({ anchor, meta });
const status = (over: Partial<ChapterStatus> = {}): ChapterStatus => ({ summary: null, distillation: null, waiting: 0, ...over });

describe('readLink', () => {
  const at = (progress: number) => ({ unit: 'ch01', anchor: 'ch01/p010', progress, updated_at: '2026-09-26T12:00:00Z' });

  it('starts an unread chapter, continues a started one at its block and re-reads a finished one from the top', () => {
    expect(readLink(undefined, unit('ch01'))).toEqual({ anchor: 'ch01', label: 'Read' });
    expect(readLink(at(0), unit('ch01'))).toEqual({ anchor: 'ch01', label: 'Read' });
    expect(readLink(at(0.5), unit('ch01'))).toEqual({ anchor: 'ch01/p010', label: 'Continue reading' });
    expect(readLink(at(0.99), unit('ch01'))).toEqual({ anchor: 'ch01', label: 'Read again' });
  });
});

describe('chapterBadge', () => {
  it('puts drafts to review before anything else, even on front matter', () => {
    expect(chapterBadge(status({ distillation: 'approved', waiting: 3 }), unit('ch01'))).toEqual({ tone: 'attention', text: '3 to review', href: '/review' });
    expect(chapterBadge(status({ waiting: 1 }), unit('front', { front_matter: true }))?.text).toBe('1 to review');
  });

  it('says how far the distillation got, quietly when there is nothing to do', () => {
    expect(chapterBadge(status({ distillation: 'approved' }), unit('ch01'))).toEqual({ tone: 'done', text: 'Distilled' });
    expect(chapterBadge(status({ distillation: 'needs_review' }), unit('ch01'))?.tone).toBe('attention');
    expect(chapterBadge(status({ summary: 'approved' }), unit('ch01'))).toEqual({ tone: 'quiet', text: 'Summarized' });
    expect(chapterBadge(undefined, unit('ch01'))).toEqual({ tone: 'quiet', text: 'Not distilled' });
  });

  it('says nothing about chapters that are not distilled by design', () => {
    expect(chapterBadge(status(), unit('front', { front_matter: true }))).toBeNull();
    expect(chapterBadge(status(), unit('ch09', { skip: true }))).toBeNull();
  });
});

describe('contentsSummary', () => {
  const units = [unit('front', { front_matter: true }), unit('ch01'), unit('ch02'), unit('ch03', { skip: true })];

  it('counts chapters (not front matter), the distilled ones among those distilled at all, and drafts waiting', () => {
    expect(contentsSummary(units, { ch01: status({ distillation: 'approved' }), ch02: status({ waiting: 2 }), front: status({ waiting: 1 }) })).toEqual({
      chapters: '3 chapters',
      work: '1 distilled · 3 to review',
    });
  });

  it('says when every chapter that can be is distilled', () => {
    expect(contentsSummary(units, { ch01: status({ distillation: 'approved' }), ch02: status({ distillation: 'approved' }) }).work).toBe('all distilled');
    expect(contentsSummary([unit('front', { front_matter: true })], {})).toEqual({ chapters: '0 chapters', work: null });
  });
});
