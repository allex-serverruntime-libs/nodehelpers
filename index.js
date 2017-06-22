var CWD_HISTORY = [], 
  Path = require('path'), 
  Os = require('os'), 
  Fs = require('fs'),
  Colors = require('colors/safe'), 
  lib = require('allexlib'),
  Q = lib.q,
  mkdirp = require('mkdirp'),
  Child_process = require('child_process'),
  BunyanLogger = require('allex_bunyanloggerserverruntimelib'),
  inspect = require('util').inspect,
  executeCommand,
  ensureDir;

var SystemRoot = (Os.platform === "win32") ? process.cwd().split(Path.sep)[0] : "/",
  HomeDir = process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'],
  FileLogger = null;


function startFileLogging (file_path, rotation_interval, backcopies, app_name) {
  if (FileLogger) return false;
  FileLogger = new BunyanLogger(file_path, rotation_interval, backcopies, app_name);
  return true;
}

function toString (item) {
  /*
  if (item instanceof Error) {
    return item.message;
  }
  */
  try {
    if ('object' === typeof(item)) {
      return inspect(item, {depth: 11});
    }
  }catch (e) {
  }
  return item ? item.toString() : item;
}

function log (cb, args) {
  console.log(cb.apply(cb, Array.prototype.map.call(args, toString)));
}

function info () {
  if (FileLogger) FileLogger.info.apply(FileLogger, arguments);
  Array.prototype.unshift.call(arguments, 'Info:');
  log.call(null, Colors.green, arguments);
}

function error() {
  if (FileLogger) FileLogger.error.apply(FileLogger, arguments);
  Array.prototype.unshift.call(arguments, 'Error :');
  log.call(null, Colors.red, arguments);
}

function warn() {
  if (FileLogger) FileLogger.warn.apply(FileLogger, arguments);
  Array.prototype.unshift.call(arguments, 'Warning :');
  log.call(null, Colors.yellow, arguments);
}


function exit (e, code) {
  error(e);
  process.exit(code);
}

function cwdStore() {
  CWD_HISTORY.push (process.cwd());
}
function cwdStepBack() {
  process.chdir (CWD_HISTORY.pop());
}

function getRoot () {
  return SystemRoot;
}

function isPathAbsolute (p) {
  return Path.resolve(p) === Path.normalize(p);
}

function absolutizePath(p, dir) {
  return dir ? Path.normalize (Path.resolve(dir, p)) : Path.normalize(Path.resolve(p));
}

function cwdGoto (path, store) {
  var current = process.cwd();
  if (!dirExists(path)) throwerror ('Unable to chdir to '+path+' ,dir not accessable');
  if (store) cwdStore();
  process.chdir(path);
  return current;
}

function findFileUpTheFS(current, filename) {
  if (!current) current = process.cwd();
  while (!Fs.existsSync(Path.join(current, filename)) && current !== SystemRoot){
    current = Path.resolve(current, '..');
  }
  if (current === SystemRoot) {
    throw Error("Unable to find "+filename+" from "+process.cwd());
  }
  return current;
}

function getPackagePath(current) {
  return findFileUpTheFS(current, 'package.json');
}

function getProtoboardPath (current) {
  return findFileUpTheFS(current, 'protoboard.json');
}

function getNamespacePath (current) {
  return findFileUpTheFS(current, '.allexns.json');
}

function gotoPackagePath(store, current) {
  if (!current) current = process.cwd();
  if (store) cwdStore();
  process.chdir(getPackagePath(current));
  return current;
}

function fileExists(p) {
  if (!Fs.existsSync(p)) return false;
  var stat = Fs.statSync(p);
  return stat.isFile();
}

function dirExists (p) {
  if (!Fs.existsSync(p)) return false;
  var stat = Fs.statSync(p);
  return stat.isDirectory();
}

function dirIsEmpty (p) {
  var files, fi;
  if (!Fs.existsSync(p)) return false;
  files = Fs.readdirSync(p);
  fi = files.indexOf('.');
  if (fi>=0) {
    files.splice(fi,1);
  }
  fi = files.indexOf('..');
  if (fi>=0) {
    files.splice(fi,1);
  }
  return files && files.length===0;
}

function removeDirIfEmpty(p) {
  if (dirIsEmpty(p)) {
    removeSync(p);
  }
}

function readJSONSync(path) {
  //options may be introduced in form of {throws: true/false}
  var json = Fs.readFileSync(path); //because this may throw hard
  if (json) {
    json = json.toString('utf-8');
  }
  return JSON.parse(json); //because this may throw hard
}

function packageRead (should_goto, should_store, current) {
  var p = Path.join(getPackagePath(current), 'package.json');
  if (!fileExists(p)) return undefined;
  if (should_goto) gotoPackagePath(should_store);
  return readJSONSync(p);
}

function CommandError (command, err, stderr, stdout) {
  this.command = command;
  this.error = error;
  this.stderr = stderr;
  this.stdout = stdout;
}

CommandError.prototype.toString = function () {
  return this.command+' failed '+this.stderr;
};

function commandResponse (command, d, error, stdout, stderr) {
  if (error) {
    d.reject(new CommandError(
      command,
      error,
      stderr,
      stdout
    ));
  }else{
    d.resolve({stdout:stdout, stderr: stderr});
  }
}

function executeCommandSync (command, options) {
  return Child_process.execSync(command, options || {});
}

function ensureDirSync (dir) {
  if (dirExists(dir)) return;
  return mkdirp.sync(dir);
}

function recreateDir (dir) {
  if (dirExists(dir)) {
    Fs.removeSync(dir);
  }
  ensureDirSync(dir);
}

function ext_matches (ext, filename){
  if (!ext) return true;

  var extname = Path.extname(filename).slice(1);

  if (ext instanceof RegExp) {
    return extname.match (ext);
  }

  return extname === ext;
}
function readDirExtOnly (dir, ext) {
  if (!dirExists(dir)) throwerror ('Missing dir '+dir);
  return Fs.readdirSync(dir).filter(ext_matches.bind(null, ext));
}

function safeReadJSONFileSync (path) {
  if (!fileExists(path)) return undefined;
  try {
    return readJSONSync(path);
  }catch (e) {
    throwerror('Unable to read JSON file at path:'+path+' due to '+e.message);
  }
}

function remove (path) {
  return executeCommand ('rm -rf '+path);
}

function removeSync (path) {
  return executeCommandSync('rm -rf '+path);
}

Fs.copySync = function (src, dst) {
  return executeCommandSync('cp -r '+src+' '+dst);
}

function getJsonParams (options) {
  if (!options) options = {spaces: 2};
  if (!options.spaces) options.spaces = 2;
  return options;
}

Fs.writeJSONSync = function (file, data, options) {
  options = getJsonParams(options);
  return Fs.writeFileSync(file, JSON.stringify(data, null, options.spaces));
};

Fs.writeJSON = function (file, data, options, cb) {
  options = getJsonParams(options);
  return Fs.writeFile(file, JSON.stringify(data, null, options.spaces), cb);
};

function throwerror(err) {
  error(err);
  if (!(err instanceof Error)) {
    err = Error(err);
  }
  throw err;
}

function isPathAbsolute (path) {
  //is not crossplatform at this moment ... supports unix systems only
  return path.match(/^\//);
}

function commandExistsSync (command) {
  try {
    var ret = executeCommandSync('which '+command);
    return ret.length > 0;
  }catch (ignore) {
    return false;
  }
}

function considerReading (ret, root, prefix, item) {
  var current_path = Path.resolve(root, item);
  if (dirExists(current_path)) {
   Array.prototype.push.apply(ret, _readdirRecursively(current_path, prefix ? Path.join(prefix, item) : item));
  }else{
    ret.push (prefix ? Path.join (prefix, item) : item);
  }
}

function _readdirRecursively (root, prefix) {
  var ret = [];
  Fs.readdirSync(root).forEach (considerReading.bind(null, ret, root, prefix));
  return ret;
}

function readdirRecursively (root) {
  return _readdirRecursively(Path.resolve(root), null);
}

Fs.readdirRecursively = readdirRecursively;

function getField (name, obj) {
  return obj[name];
}

function checkAndReadJSON (path) {
  path = Path.resolve(path || './');
  if (!Fs.fileExists(path)) throw new Error('Unable to find json file: '+path);
  var data = Fs.safeReadJSONFileSync(path);
  if (!data) throw new Error('Unable to read json at '+path);
  return data;
}

function update_or_get_field (data, field, update) {
  var resolved_path = [];
  if (lib.isString(field)) field = field.split('.');
  if (!lib.isArray(field)) throw new Error('Unable to resolve field, invalid format: '+field);
  for (var i = 0; i < field.length; i++) {
    if (!data[field[i]]) return {val: undefined, resolved_path: resolved_path.join('.'), last:data};
    data = data[field[i]];
    resolved_path.push (field[i]);
  }

  if (arguments.length >= 3) {
    data = update;
  }

  return {val: data, resolved_path: resolved_path.join('.')};
}

function readFieldFromJSONFile (path, field){
  var data = checkAndReadJSON(path);
  if (!field) return data;
  return update_or_get_field(data, field).val;
}

function writeFieldToJSONFile (path, field, json_or_obj, force_creation) {
  ///TODO: imas u lib-u ili negde slicno dot separated val ...
  if (!field) throw new Error('No field given');
  if (!json_or_obj) throw new Error('No data given');

  if (lib.isString(json_or_obj)) {
    try {
      json_or_obj = JSON.parse(json_or_obj);
    }catch (e) {
      throw new Error('Invalid JSON: '+json_or_obj);
    }
  }
  var or_data = checkAndReadJSON(path);
  var ret = update_or_get_field(or_data, field, json_or_obj);
  if (ret.resolved_path === field) {
    Fs.writeJSONSync(path, or_data);
    return ret.val;
  }

  if (!force_creation) return {
    force_required: true,
    resolved_path: ret.resolved_path,
    val: ret.val
  };
  var fa = field,
    f, td = or_data;
  if (lib.isString(fa)) fa = fa.split('.');

  while (fa.length > 1) {
    f = fa.shift();
    if (!(f in td)) td[f] = {};
    if ('object' !== typeof(td[f])) throw new Error('Unable to extend non object field');
    td = td[f];
  }
  td[fa[0]] = json_or_obj;
  Fs.writeJSONSync(path, or_data);
}

function writeFieldToJSONFile2 (path, field, value) {
  if (!field) return;
  var data = checkAndReadJSON(path) || {};
  var fa = field,
    f, td = data;
  if (lib.isString(fa)) fa = fa.split('.');

  while (fa.length > 1) {
    f = fa.shift();
    if (!(f in td)) td[f] = {};
    if ('object' !== typeof(td[f])) throw new Error('Unable to extend non object field');
    td = td[f];
  }
  td[fa[0]] = value;
  Fs.writeJSONSync(path, data);
}


function createNodeHelpers (lib) {
  executeCommand = function (command, d, options, bridge_streams) {
    //console.log('About to execute command ', command, d, options);
    if (!d) d = Q.defer();
    //console.log('about to do a command ', command, 'with options',options);
    var p = Child_process.exec(command, options || {}, commandResponse.bind(null, command, d));
    if (bridge_streams) {
      p.stdout.pipe(process.stdout);
      p.stderr.pipe(process.stderr);
    }
    return d.promise;
  }

  ensureDir = function (dir) {
    var d, ret;
    if (dirExists(dir)) return Q.resolve(dir);
    d = Q.defer();
    ret = d.promise;
    mkdirp(dir, null, function (err, made) {
      if (err) {
        d.reject(new Error('mkdirp '+dir+' failed on directory '+made));
      } else {
        d.resolve(dir);
      }
      d = null;
      dir = null;
    });
    return ret;
  }

  Fs.remove = remove;
  Fs.removeSync = removeSync;
  Fs.ensureDir = ensureDir;
  Fs.ensureDirSync = ensureDirSync;
  Fs.removeDirIfEmpty = removeDirIfEmpty;
  Fs.fileExists = fileExists;
  Fs.dirExists = dirExists;
  Fs.dirIsEmpty = dirIsEmpty;
  Fs.recreateDir = recreateDir;
  Fs.readDirExtOnly = readDirExtOnly;
  Fs.safeReadJSONFileSync = safeReadJSONFileSync;
  Fs.readJSONSync = readJSONSync;
  Fs.systemRoot = function () {return SystemRoot;};
  Fs.systemHome = function () {return HomeDir;};
  Fs.writeFieldToJSONFile = writeFieldToJSONFile;
  Fs.writeFieldToJSONFile2 = writeFieldToJSONFile2;
  Fs.readFieldFromJSONFile = readFieldFromJSONFile ;

  return {
    commandExistsSync : commandExistsSync,
    isPathAbsolute: isPathAbsolute,
    cwdStore : cwdStore,
    cwdStepBack: cwdStepBack,
    cwdGoto : cwdGoto,
    getPackagePath : getPackagePath,
    getProtoboardPath: getProtoboardPath,
    getNamespacePath: getNamespacePath,
    findFileUpTheFS : findFileUpTheFS,
    gotoPackagePath : gotoPackagePath,
    packageRead: packageRead,
    error: error,
    throwerror: throwerror,
    warn: warn,
    info: info,
    executeCommand: executeCommand,
    executeCommandSync: executeCommandSync,
    Fs : Fs,
    isPathAbsolute: isPathAbsolute,
    absolutizePath : absolutizePath,
    exit:exit,
    readdirRecursively : readdirRecursively,
    startFileLogging : startFileLogging
  };
}

module.exports = createNodeHelpers;
