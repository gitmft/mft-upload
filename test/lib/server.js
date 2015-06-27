// ./lib/server.js

var http = require('http');

var server = module.exports = http.createServer(function (req, res) {

/* Headers
 {"content-type":"text/xml; charset=utf-8","host":"localhost:8000","authorization":"Basic VVNFUk5BTUU6UEFTU1dPUkQ=","content-length":"5536","connection":"close"}
*/

var body = '';
var payloadType = 'InlineXML';
var uri = '/mftapp/services/transfer/SOAP2File';
var myUri = req.url;
var ucmUri = '/idcws/GenericSoapPort';
var ucmresp = 'test/ucm_bad_response_body';
var ct = 'text/xml; charset=utf-8';

  //console.log('SERVER URI:' +myUri);

  if (req.headers['content-type'] != ct) {
    retres(res, 400, 'Invalid Header Content Type');
  } else if (ucmUri === myUri) {
    var fs = require('fs');
    //console.log('TESTING UCM URI:' +myUri);
    var uresp = fs.readFileSync(ucmresp, "utf8");
    retres(res, 200, uresp);
  } else if (uri != myUri) {
    retres(res, 500, 'Invalid Request URL');
  } else {
    req.on('data', function (chunk) {
      body += chunk.toString();
      //console.log('BODY:' +body);
    });

  req.on('end', function () {
    parsexml(body, function(err, pt) {
      if (err) {
        retres(res, 500, 'Invalid BODY');
        server.emit('Error', body);
      } else {
        if (pt === payloadType) {
          retres(res, 200, 'Success');
          server.emit('Success', body);
        } else {
          retres(res, 500, 'Invalid Payload Type ' +pt);
          server.emit('Error', body);
        };
      };
    });
  });
  };
});

function retres(res, rc, str)  {
          res.writeHead(rc, {'Content-Type': 'text/plain'});
          res.end(str);
};

function parsexml(xml, cb) {
  var xml2js = require('xml2js');
  var po = { mergeAttrs: 'true'};
  var mj = '';
  //console.log('PARSE xml:' +xml);

  var parser = new xml2js.Parser(po);
  parser.parseString(xml, function (err, json) {
    mj = json;
    if (err) {
      var serr = '' +err;
      var allow = 'Error: Non-whitespace before first tag';
      if (serr.indexOf(allow) != 0) {
        var e2 = 'validateSOAPResponse parse error: ' +serr;
        return cb(e2, mj);
      };
    };
    //console.log(JSON.stringify(mj));
    var env = mj["soap:Envelope"];
    var hdr = env["soap:Header"];
    var bdy = env["soap:Body"];
    var mhd = hdr[0]["ns1:MFTHeader"];
    var inp = bdy[0]["ns1:MFTServiceInput"];
    var pt = inp[0]["PayloadType"][0];
    //console.log(pt);
    return cb('', pt);
  });
};


/*
basic auth testing for later
http.createServer(function(req,res){
  var header=req.headers['authorization']||'',        // get the header
      token=header.split(/\s+/).pop()||'',            // and the encoded auth token
      auth=new Buffer(token, 'base64').toString(),    // convert from base64
      parts=auth.split(/:/),                          // split on colon
      username=parts[0],
      password=parts[1];

  res.writeHead(200,{'Content-Type':'text/plain'});
  res.end('username is "'+username+'" and password is "'+password+'"');

}).listen(8000,'127.0.0.1');

*/
