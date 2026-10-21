'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { attachArchiveAbort } = require('../lib/archive-lifecycle');

function fixture() {
  const req = new EventEmitter();
  const res = new EventEmitter();
  const archive = new EventEmitter();
  archive.abortCalls = 0;
  archive.abort = () => { archive.abortCalls += 1; };
  return { req, res, archive };
}

test('request abort or premature response close aborts archive once and removes listeners', () => {
  const state = fixture();
  attachArchiveAbort(state.req, state.res, state.archive);
  state.req.emit('aborted');
  state.res.emit('close');
  state.req.emit('aborted');
  assert.equal(state.archive.abortCalls, 1);
  assert.equal(state.req.listenerCount('aborted'), 0);
  assert.equal(state.res.listenerCount('close'), 0);
  assert.equal(state.res.listenerCount('finish'), 0);
  assert.equal(state.archive.listenerCount('end'), 0);
});

test('normal completion removes abort listeners without aborting archive', () => {
  const state = fixture();
  attachArchiveAbort(state.req, state.res, state.archive);
  state.res.emit('finish');
  state.res.emit('close');
  state.req.emit('aborted');
  assert.equal(state.archive.abortCalls, 0);
  assert.equal(state.req.listenerCount('aborted'), 0);
  assert.equal(state.res.listenerCount('close'), 0);
  assert.equal(state.res.listenerCount('finish'), 0);
  assert.equal(state.archive.listenerCount('end'), 0);
});

test('premature response close alone aborts once', () => {
  const state = fixture();
  state.res.writableFinished = false;
  attachArchiveAbort(state.req, state.res, state.archive);
  state.res.emit('close');
  state.res.emit('close');
  assert.equal(state.archive.abortCalls, 1);
  assert.equal(state.req.listenerCount('aborted'), 0);
  assert.equal(state.res.listenerCount('close'), 0);
});
