const path = require("path");
const fs = require("fs");

const asyncjs = require("async");
const glob = require("glob");
const xml2js = require("xml2js");

module.exports = function MuAssetsLoader(source, context) {
  this.cacheable();
  const cb = this.async();
  const version = this.version;

  _main(this, [], process.cwd(), source, context, function(err, data) {
    if (err) {
      console.error(err);
      cb(err);
    } else {
      try {
        const content = _serializeAssetdata(data);

        if (version && version >= 2) {
          cb(null, `
          export default ${content};
          `);
        } else {
          cb(null, `
          module.exports = ${content};
          `);
        }
      } catch (e) {
        console.error(e);
        cb(e);
      }
    }
  });
}

function _main(self, dest, cwd, source, context, cb) {
  try {
    const config = JSON.parse(source);

    asyncjs.parallel((config.imports || []).map(function(e) {
      return function(cb2) {
        fs.readFile(e, (err, data) => {
          if (err) {
            cb2(err);
          } else {
            self.addDependency(e)
            _main(self, dest, path.join(cwd, path.dirname(e)), data.toString(), context, cb2);
          }
        });
      };
    }), function(err, imported) {
      if (err) {
        cb(err);
      } else {
        imported = imported.reduce((m, v) => m.concat(v), []);

        asyncjs.waterfall([
          (cb2) => { _generateFilelist(config.include, config.exclude, cwd, cb2); },
          (data, cb2) => { _readFilelist(data, cb2); },
          (data, cb2) => { _unserializeFilelist(data, cb2); },
        ], (err, data) => {
          if (err) {
            console.error(err);
            cb(err);
          } else {
            try {
              for (let e of data) {
                self.addDependency(e.fname)
              }

              cb(null, dest.concat(_createAssetdata(imported.concat(data))));
            } catch (e) {
              cb(err);
            }
          }
        });
      }
    });
  } catch (err) {
    cb(err);
  }
}

function _generateFilelist(includes, exclude, cwd, cb) {
  asyncjs.parallel(includes.map((e) => {
    return (cb2) => {
      glob.glob(path.join(cwd, e), {
        ignore: exclude,
        nodir: true,
      }, cb2);
    };
  }), (err, data) => {
    if (err) {
      cb(err);
    } else {
      cb(null, data.reduce((m,v) => m.concat(v)));
    }
  });
}

function _readFilelist(filelist, cb) {
  asyncjs.parallel(filelist.map((e) => {
    return (cb2) => {
      fs.readFile(e, (err, data) => {
        if (err) {
          cb2(err);
        } else {
          cb2(null, { fname: e, content: data });
        }
      });
    };
  }), cb);
}

function _unserializeFilelist(filelist, cb) {
  asyncjs.parallel(filelist.map((e) => {
    return (cb2) => {
      try {
        const json = JSON.parse(e.content);
        cb2(null, { fname: e.fname, data: json });
      } catch (err) {
        xml2js.parseString(e.content, {
          explicitChildren: true,
          preserveChildrenOrder: true,
        }, (err2, xml) => {
          if (err2) {
            cb2(null, { fname: path.relative(process.cwd(), e.fname) });
          } else {
            cb2(null, { fname: path.relative(process.cwd(), e.fname), data: xml });
          }
        });
      }
    };
  }), cb);
}

function _createAssetdata(filedata) {
  return filedata.map((e) => {
    if (_isPath(e.data)) {
      return { fname: e.fname, type: "path", data: e.data };
    } else if (_isSprite(e.data)) {
      return { fname: e.fname, type: "sprite", data: e.data };
    } else if (_isTileset(e.data)) {
      return { fname: e.fname, type: "tileset", data: e.data };
    } else if (_isStage(e.data)) {
      return { fname: e.fname, type: "stage", data: e.data };
    } else if (_isImage(e.fname)) {
      return { fname: e.fname, type: "rawimage", data: e.fname };
    } else {
      return { fname: e.fname };
    }
  });
}

function _serializeAssetdata(assetdata) {
  const index = assetdata.reduce((m,v) => {
    if (v.type !== undefined) {
      m[path.basename(v.fname)] = JSON.stringify({ type: v.type, data: v.data });
    } else {
      const basename = path.basename(v.fname);
      const modulename = path.join(path.dirname(v.fname), basename.split(".")[0]);

      const name = basename.split(".")[0].split("-").map((e) => {
        return e[0].toUpperCase() + e.substr(1).toLowerCase();
      }).join("");

      m[basename.split(".")[0]] = `{ data: require("./${modulename}")["${name}"] }`;
    }

    return m;
  }, {});

  let rval = "";

  for (let e in index) {
    rval += `"${e}": ${index[e]},\n`
  }

  return `{\n  ${rval}\n}\n`;
}

// TODO do JSON schema checks instead

function _isPath(data) {
  return (typeof data === "object") &&
         (typeof data.meta === "object") &&
         (data.meta.type === "path");
}

function _isSprite(data) {
  return (typeof data === "object") &&
         (typeof data.meta === "object") &&
         (data.meta.app === "http://www.aseprite.org/");
}

function _isTileset(data) {
  return ((typeof data === "object") &&
         (data.type === "tileset")) ||
         ((typeof data === "object") &&
         (typeof data.tileset === "object"));
}

function _isStage(data) {
  return (typeof data === "object") &&
         (typeof data.map === "object") &&
         (typeof data.map.$ === "object") &&
         (typeof data.map.$.tiledversion === "string");
}

function _isImage(fname) {
  return /\.(png)$/i.test(fname);
}
