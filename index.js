const path = require("path");
const fs = require("fs");

const asyncjs = require("async");
const glob = require("glob");
const xml2js = require("xml2js");

module.exports = function MuAssetsLoader(source, context) {
  this.cacheable();
  const cb = this.async();
  const config = JSON.parse(source);
  const version = this.version;

  asyncjs.waterfall([
    (cb2) => { _generateFilelist(config.include, config.exports, cb2); },
    (data, cb2) => { _readFilelist(data, cb2); },
    (data, cb2) => { _unserializeFilelist(data, cb2); },
  ], (err, data) => {
    if (err) {
      console.error(err);
      cb(err);
    } else {
      try {
        for (let e of data) {
          this.addDependency(e.fname)
        }

        const assetData = _createAssetdata(data);
        const content = _serializeAssetdata(assetData);

        if (version && version >= 2) {
          cb(null, `
          import { Assets } from "mu-engine";
          export default ${content};
          `);
        } else {
          cb(null, `
          const Assets = require("mu-engine").Assets;
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

function _generateFilelist(includes, exclude, cb) {
  asyncjs.parallel(includes.map((e) => {
    return (cb2) => {
      glob.glob(e, {
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
        xml2js.parseString(e.content, (err2, xml) => {
          if (err2) {
            cb2(null, { fname: e.fname });
          } else {
            cb2(null, { fname: e.fname, data: xml });
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
    } else {
      return { fname: e.fname };
    }
  });
}

function _serializeAssetdata(assetdata) {
  const list = assetdata.map((e) => {
    if (e.type !== undefined) {
      return `"${path.basename(e.fname)}": ${JSON.stringify({ type: e.type, data: e.data })},`;
    } else {
      const basename = path.basename(e.fname);
      const modulename = path.join(path.dirname(e.fname), basename.split(".")[0]);

      const name = basename.split(".")[0].split("-").map((e) => {
        return e[0].toUpperCase() + e.substr(1).toLowerCase();
      }).join("");
      return `"${basename.split(".")[0]}": { data: require("./${modulename}")["${name}"] },`;
    }
  })

  return `new Assets({
    preload: true,
    assets: {
      ${list.join("\n")}
    }
  })`;
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
  return (typeof data === "object") &&
         (data.type === "tileset");
}

function _isStage(data) {
  return (typeof data === "object") &&
         (typeof data.map === "object") &&
         (typeof data.map.$ === "object") &&
         (typeof data.map.$.tiledversion === "string");
}
