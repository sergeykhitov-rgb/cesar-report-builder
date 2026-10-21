'use strict';

function attachArchiveAbort(req, res, archive) {
  let complete = false;
  let aborted = false;

  function cleanup() {
    req.removeListener('aborted', abort);
    res.removeListener('close', onClose);
    res.removeListener('finish', finish);
    archive.removeListener('end', finish);
  }
  function finish() {
    if (complete || aborted) return;
    complete = true;
    cleanup();
  }
  function abort() {
    if (complete || aborted) return;
    aborted = true;
    cleanup();
    archive.abort();
  }
  function onClose() {
    if (!res.writableFinished) abort();
    else finish();
  }

  req.once('aborted', abort);
  res.once('close', onClose);
  res.once('finish', finish);
  archive.once('end', finish);
  if (req.aborted || res.destroyed) abort();

  return { cleanup, isAborted: function () { return aborted; } };
}

module.exports = { attachArchiveAbort };
