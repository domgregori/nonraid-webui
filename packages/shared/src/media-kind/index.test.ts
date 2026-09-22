import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveInlineMedia } from './index.js';

describe('resolveInlineMedia', () => {
  it('recognizes common image extensions', () => {
    assert.deepEqual(resolveInlineMedia('photo.jpg'), { kind: 'image', contentType: 'image/jpeg' });
    assert.deepEqual(resolveInlineMedia('photo.PNG'), { kind: 'image', contentType: 'image/png' });
  });

  it('recognizes common video/audio extensions', () => {
    assert.deepEqual(resolveInlineMedia('clip.mp4'), { kind: 'video', contentType: 'video/mp4' });
    assert.deepEqual(resolveInlineMedia('song.mp3'), { kind: 'audio', contentType: 'audio/mpeg' });
  });

  it('recognizes pdf', () => {
    assert.deepEqual(resolveInlineMedia('doc.pdf'), { kind: 'pdf', contentType: 'application/pdf' });
  });

  it('refuses HTML-adjacent formats that could execute as a live page - the actual security property this module exists for', () => {
    assert.equal(resolveInlineMedia('evil.svg'), null);
    assert.equal(resolveInlineMedia('evil.html'), null);
    assert.equal(resolveInlineMedia('evil.htm'), null);
    assert.equal(resolveInlineMedia('evil.xhtml'), null);
    assert.equal(resolveInlineMedia('evil.xml'), null);
  });

  it('refuses plain text and unknown extensions - inline-view has its own separate text path', () => {
    assert.equal(resolveInlineMedia('notes.txt'), null);
    assert.equal(resolveInlineMedia('archive.zip'), null);
    assert.equal(resolveInlineMedia('noextension'), null);
  });

  it('is not fooled by a double extension trying to smuggle a real type past a naive check', () => {
    // "evil.html.pdf" - extname() correctly looks only at the last segment, so this is (rightly)
    // treated as a pdf; the real defense against a mislabeled-content attack is the caller always
    // setting Content-Type explicitly from this table (never trusting the file's own claimed
    // type) plus X-Content-Type-Options: nosniff, not string-matching the filename harder.
    assert.deepEqual(resolveInlineMedia('evil.html.pdf'), { kind: 'pdf', contentType: 'application/pdf' });
  });
});
