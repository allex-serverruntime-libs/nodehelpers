var fs = require('fs'),
  Path = require('path');

function createDirDeleter(lib) {
  'use strict';

  var q = lib.q,
    qlib = lib.qlib,
    JobBase = qlib.JobBase,
    RETRY_MS = 100,
    MAX_UNLINK_RETRIES = 600, //60 s of EBUSY on one file, then give up and report
    MAX_RMDIR_RETRIES = 100; //10 s of a directory that keeps getting refilled

  //somebody else already removed it, which is what we wanted
  function isGone (err) {
    return !!err && err.code === 'ENOENT';
  }

  //the directory got refilled or is still held open (e.g. by a db that is still closing)
  function isTransientRmdirError (err) {
    return !!err && (err.code === 'ENOTEMPTY' || err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EEXIST');
  }

  function DirDeleter(path, defer) {
    JobBase.call(this, defer);
    this.path = path;
    this.rmdirRetries = 0;
  }
  lib.inherit(DirDeleter, JobBase);
  DirDeleter.prototype.destroy = function () {
    this.rmdirRetries = null;
    this.path = null;
    JobBase.prototype.destroy.call(this);
  };
  DirDeleter.prototype.go = function () {
    this.scan();
    return this.defer ? this.defer.promise : q(false);
  };
  DirDeleter.prototype.scan = function () {
    if (!this.path) {
      return;
    }
    fs.exists(this.path, this.onExists.bind(this));
  };
  DirDeleter.prototype.onExists = function (exists) {
    if (!exists) {
      this.resolve(true);
      return;
    }
    fs.readdir(this.path, this.onDirContents.bind(this));
  };
  DirDeleter.prototype.onDirContents = function (err, list) {
    if (err) {
      if (isGone(err)) {
        this.resolve(true);
      } else {
        this.reject(err);
      }
      return;
    }
    q.all(list.map(this.deleteFsItem.bind(this))).then(
      this.onDirClear.bind(this),
      this.reject.bind(this)
    );
  };
  DirDeleter.prototype.onDirClear = function () {
    if (!this.path) {
      return;
    }
    fs.rmdir(this.path, this.onDirDeleted.bind(this));
  };
  DirDeleter.prototype.onDirDeleted = function (err) {
    if (!err || isGone(err)) {
      this.resolve(true);
      return;
    }
    if (isTransientRmdirError(err) && this.rmdirRetries < MAX_RMDIR_RETRIES) {
      //something wrote into the directory after we listed it; list it again
      this.rmdirRetries++;
      console.error('rmdir', this.path, err.code, 'will rescan and retry');
      lib.runNext(this.scan.bind(this), RETRY_MS);
      return;
    }
    this.reject(err);
  };
  DirDeleter.prototype.deleteFsItem = function (fsitemname) {
    var d = q.defer(), fsitempath = Path.join(this.path, fsitemname);
    fs.lstat(fsitempath, this.onItemStats.bind(this, d, fsitempath));
    return d.promise;
  };
  DirDeleter.prototype.onItemStats = function (defer, fsitempath, err, stats) {
    if (err) {
      if (isGone(err)) {
        defer.resolve(true);
      } else {
        defer.reject(err);
      }
      return;
    }
    if (stats.isDirectory()) {
      (new DirDeleter(fsitempath, defer)).go();
    } else {
      this.unlink(fsitempath, defer, 0);
    }
  };
  DirDeleter.prototype.unlink = function (fsitempath, defer, attempt) {
    fs.unlink(fsitempath, this.onUnlinked.bind(this, fsitempath, defer, attempt));
  };
  DirDeleter.prototype.onUnlinked = function (fsitempath, defer, attempt, err) {
    if (!err || isGone(err)) {
      defer.resolve(true);
      return;
    }
    if (attempt >= MAX_UNLINK_RETRIES) {
      defer.reject(err);
      return;
    }
    console.error('err', err, 'will retry');
    lib.runNext(this.unlink.bind(this, fsitempath, defer, attempt+1), RETRY_MS);
  };

  function deleteDirAsPromised (path) {
    return new DirDeleter(path).go();
  }

  //cb(true) once the directory is gone, cb(false, err) if it could not be deleted.
  //It used to be .then(cb) only: a failed delete never called cb at all, and
  //whatever was waiting on it (e.g. a leveldb reopen) waited forever, silently.
  function deleteDir (path, cb) {
    deleteDirAsPromised(path).then(
      function () {
        cb(true);
      },
      function (err) {
        console.error('Could not delete directory', path, err);
        cb(false, err);
      }
    );
  }

  return {
    deleteDirWithCB: deleteDir,
    deleteDirWithPromise: deleteDirAsPromised
  };
}

module.exports = createDirDeleter;
