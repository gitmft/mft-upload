var request = require('request');
var fs = require("fs");
var path = require("path");
var outils = require('omft-utils');
var util = require('util');
var osenv = require('osenv');

// BEGIN INTERNAL FUNCTIONS AND PROPERTIES

var _DEFAULT_MAX_FILE_SIZE = 26*1024*1024;

function getStats(start, end,  fn, path, sz) {
  var ms = end-start
  //console.log('fn/sz/ms:' +fn +'/' +sz +'/' +ms);
  var rate = Number(sz/(ms)).toFixed(2);
  var size = Number(sz/1024).toFixed(2);
  var time = Number(ms/1000).toFixed(2);
  var s = 'Upload of file "' +fn +'" of '   +size +' kb took ' +time +' seconds at ' +rate +' KBs';
  return s;
};

// generate json from the SOAP body
// small convenience method using xml2js
var soap2json = function(soapbody, cb) {
  var xml2js = require('xml2js');
  var po = { mergeAttrs: 'true' }; 

  var parser = new xml2js.Parser(po);
  parser.parseString(soapbody, function (err, json) {
    if (err) {
      var e2 = 'soap2json error: ' +err;
      return cb(e2, json);
    };

    var env = json["env:Envelope"];
    var hdr = env["env:Header"];
    var bdy = env["env:Body"];

    return cb(err, json);
  });
};
// END INTERNAL ONLY FUNCTIONS

// BEGIN EXPORTED FUNCTIONS
// the majority of the work is done here uploading the file
var fileUpload = function(fn, cfg, cb) {
  // cb(er, respcode, body, stats)
  var stats = {};
  var myer = '';
  var filebody, resp = '';
  var start, end; 
  var filename =  path.basename(filepath);
  var filesize = 0;
  var rc;
  var maxsize = cfg.maxsize;
  var reqtype = cfg.type;
  var req = cfg.request;

  maxsize ? maxsize : _DEFAULT_MAX_FILE_SIZE;

  //console.log("Maxsize is: " +maxsize);

  switch (reqtype.toUpperCase()) {
        case 'SOAP':
          // generate the SOAP upload payload
          outils.genUploadSOAP(filepath, maxsize, reqtype, function(er, fs, bdy) {
            if (er) {
              var err = 'fileUpload error: ' +er;
              return cb(err);
            }
            filesize = fs;
            req.body = bdy;
          }); 
          break;
        case 'FORM':
          var formname = cfg.formname;
	  console.log("formname is " +formname);
          req.formData[formname].value = fs.readFileSync(filepath, "utf8");
          break;
        default:
          var rerr = "Error: Invalid Request Type: " +reqtype;
          return cb(rerr);
      }
  // invoke the request with timings
  start = new Date();
  end = new Date();

  request(req, function (error, response, body) {
    resp = response;
    if (error) {
	console.log('fileupload.request.error is:' +error);
	return cb(error, response);
    }
    rc = response.statusCode;
    //console.log('FileUpload Response code is:' +rc);
    end = new Date();
    if (rc == 200) {
        // Print out the response body
        //console.log(body)
    } else {
      var mer = 'ERROR: fileUpload.request Response code of ' +rc +' is not 200' +"\n";;
      mer += body;
      //console.log(mer);
      return cb(mer);
    }
    // convert body to json for return
    soap2json(body, function(err, json) {
      if (error) {
	console.log('fileUpload error is:' +err);
	return cb(error, response);
      }
      body = json;
    });
    stats.filename = filename;
    stats.filepath = filepath
    stats.filesize = filesize;
    stats.summary = getStats(start, end, filename, filepath, filesize);

    // all done, invoke the callback
    cb(myer, rc, body, stats);
  });
};

module.exports.fileUpload = fileUpload;

// getConfig
// parse the arguments to find the file to upload
// find the request json config file

//function getRequestConfig(argv, cb) {
var getRequestConfig = function(argv, cb) {
  //console.log('argv is: ' +argv);
  // return cb(err, args, cfgfile, cfgjson)
  var reqOptions;
  var DEFAULT_CONFIG_FILE = '/.mft/uploadreq.json';
  var args = outils.parseCalloutArgs(argv);
  if (!args.file) {
    var me = path.basename(process.argv[1]);
    var e1 = 'ERROR: File argument not provided' +"\n";
    var u = 'Usage: ' +me + ' file=<file> config=<json request config file>';
    var err = e1 +u;
    return cb(err);
  };

  filepath = args.file;

  if (args.config) {
    jsoncfg = args.config;
    if (!path.isAbsolute(jsoncfg)) {
      //console.log('path is ' +path.dirname(jsoncfg) +' ' + jsoncfg);
      jsoncfg = path.resolve(jsoncfg);
    }
  } else {
    var home = osenv.home();
    jsoncfg = home +DEFAULT_CONFIG_FILE;
  };

  try {
    //console.log(JSON.stringify(fs.readFileSync(jsoncfg, "utf8")));
    var reqOptions = JSON.parse(fs.readFileSync(jsoncfg, "utf8"));
    var cfgtype = reqOptions.type;
  } catch (ee) {
    var merr = 'getConfig config read/parse error ' +jsoncfg +' ' +ee;
    return cb(merr);
  }
  return cb('', args, jsoncfg, reqOptions);
};

module.exports.getRequestConfig = getRequestConfig;

// END EXPORTED FUNCTIONS
