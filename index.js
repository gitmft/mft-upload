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

// validate the HTTP/SOAP response looking for SOAP Faults. Mostly for MFT responses which uses 200 even for SOAP Faults
// throws an error if a fault sis found
var validateSOAPResponse = function(soapbody, cb) {
  var xml2js = require('xml2js');
  var po = { mergeAttrs: 'true'}; 
  var myerr;
  var mj;

  var parser = new xml2js.Parser(po);
  parser.parseString(soapbody, function (err, json) {

    if (err) {
      var serr = '' +err;
      var allow = 'Error: Non-whitespace before first tag';
      if (serr.indexOf(allow) != 0) {
        var e2 = 'validateSOAPResponse parse error: ' +serr;
        return cb(e2);
      };
    } else {
      mj = json;
    };
  });

  if (!mj) return cb('');

  try {
    /* example of MFT env
      { 'xmlns:env': [ 'http://schemas.xmlsoap.org/soap/envelope/' ],
        'env:Header': [ '' ],
        'env:Body': [ { 'env:Fault': [Object] } ] }
      [ { 'env:Fault': [ [Object] ] } ]
    */

    //console.log(mj);
    var env = mj["env:Envelope"];
    if (!env) return cb('');
    var hdr = env["env:Header"];
    if (!hdr) return cb('');
    var bdy = env["env:Body"];
    if (!bdy) return cb('');
    //console.log(env);
    //console.log(bdy);
    /* example of fault
    [ { 'env:Fault': [ [Object] ] } ]
    [ { faultcode: [ 'env:MFT_WS_INBOUND_INVALID_SOAP_REQUEST' ],
        faultstring: [ 'MFT message processing failed with exception code: MFT_WS_INBOUND_INVALID_SOAP_REQUEST' ],
        faultactor: [ 'http://hostname.com:7901/mftapp/services/transfer/SOAP2File' ],
        detail: [ [Object] ] } ]
    */

    var flt = bdy[0]['env:Fault'];
    if (flt) {
      var fcode = flt[0].faultcode;
      var fstr  = flt[0].faultstring;
      var fact  = flt[0].faultactor;
      var ferr = 'faultcode:' +fcode +'; ';
      ferr += 'faultstring:' +fstr +'; ';
      ferr += 'faultactor:' +fact +'; ';
      myerr = 'validateSOAPResponse parse error: ' +ferr;
      //console.log(myerr);
    };
  } catch (per) {
    return cb(per);
  };

    return cb(myerr);
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
  var filepath = fn;
  var filename =  path.basename(filepath);
  var filesize = 0;
  var rc;
  var maxsize = cfg.maxsize;
  var reqtype = cfg.type;
  var req = cfg.request;

  cfg.file = filepath || cfg.filepath;
  maxsize ? maxsize : _DEFAULT_MAX_FILE_SIZE;

  //console.log("Maxsize is: " +maxsize);

  switch (reqtype.toUpperCase()) {
        case 'FORM':
          var formname = cfg.formname;
	  console.log("formname is " +formname);
          req.formData[formname].value = fs.readFileSync(filepath, "utf8");
          break;
        case 'WSA':
          // generate the request
          outils.genUploadRequest(cfg, function(er, fsz, bdy) {
            if (er) {
              var err = 'fileUpload error: ' +er;
              return cb(err);
            }
            filesize = fsz;
            req.headers.FileName = filename;
            req.multipart[0].body = bdy;
            req.multipart[1].body = fs.createReadStream(filepath);
          }); 
          break;
        default: // SOAP, WSSE, UCM
          // special handling for WSEE to not require outils to do it
          if (cfg.request.auth.user) cfg.user=cfg.request.auth.user;
          if (cfg.request.auth.pass) cfg.pass=cfg.request.auth.pass;
          //console.log(JSON.stringify(cfg));
          //console.log(JSON.stringify(cfg));
          // generate the request payloads
          outils.genUploadRequest(cfg, function(er, fsz, bdy) {
            if (er) {
              var err = 'fileUpload error: ' +er;
              return cb(err);
            }
            filesize = fsz;
            req.body = bdy;
          }); 
          break;
      }
  // invoke the request with timings
  start = new Date();
  end = new Date();

  //console.log(req.body);

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
        //console.log(req.body);
        //console.log(body)
        validateSOAPResponse(body, function(err) {
          if (err) {
	    console.log(err); 
	    return cb(err);
          };
        });
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

  var filepath = args.file;

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
    // remove comments from the cfg file
    var strip = require('strip-json-comments');
    var reqOptions = JSON.parse(strip(fs.readFileSync(jsoncfg, "utf8")));
    //console.log(JSON.stringify(reqOptions));

    var cfgtype = reqOptions.type;
    if (!cfgtype) { 
      var cerr = 'getConfig config invalid config file:' +jsoncfg;
      return cb(cerr);
    };


  } catch (ee) {
    var merr = 'getConfig config read/parse error ' +jsoncfg +' ' +ee;
    return cb(merr);
  }
  return cb('', args, jsoncfg, reqOptions);
};

module.exports.getRequestConfig = getRequestConfig;

// END EXPORTED FUNCTIONS
