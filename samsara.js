var http = require('http'),
    redis = require('redis'),
    url = require('url'),
    fugue = require('fugue'),
    fs = require('fs'),
    redis_url = url.parse(process.env.REDIS_URL),
    redis_client = redis.createClient(redis_url['port'], redis_url['hostname'])

process.on('uncaughtException', function (err) {
  console.log(err);
});

var server = http.createServer(function(request, response) {
  path = request_path(request);
  if (path == "/monitor/health") { serve(response, "Healthy!!"); }
  var emcee_request = http.request({
    host: process.env.EMCEE_HOST,
    path: path,
    port: parseInt(process.env.EMCEE_PORT),
    method: request.method,
    headers: request.headers });

  var deejay_request = http.request({
    host: process.env.DEEJAY_HOST,
    path: path,
    port: parseInt(process.env.DEEJAY_PORT),
    method: request.method,
    headers: request.headers });

  emcee_request.on('response', function(emcee_response) {
    var status_code = emcee_response.statusCode
    var recordable = (!emcee_response.headers['content-encoding'])
    var response_body = ""
    emcee_response.on('data', function(chunk) {
      response.write(chunk, 'binary');
      if (recordable) { response_body += chunk.toString('utf8'); }
    });
    emcee_response.on('end', function() {
      response.end();
      if (recordable) { record_response("emcee", request.headers['host'] + path, status_code, response_body); }
    });
    response.writeHead(emcee_response.statusCode, emcee_response.headers);
  });

  deejay_request.on('response', function(deejay_response) {
    var status_code = deejay_response.statusCode
    var recordable = (!deejay_response.headers['content-encoding'])
    var response_body = ""
    deejay_response.on('data', function(chunk) { if (recordable) { response_body += chunk.toString('utf8'); } });
    deejay_response.on('end', function() {
      if (recordable) { record_response("deejay", request.headers['host'] + path, status_code, response_body); }
    });
  });

  request.on('data', function(chunk) {
    emcee_request.write(chunk, 'binary');
    deejay_request.write(chunk, 'binary');
  });
  request.on('end', function() {
    emcee_request.end();
    deejay_request.end();
  });
  request.on('close', function() {
    console.log("Connection terminated before expected");
  });
});

fugue.start(server, process.env.SAMSARA_PORT, "0.0.0.0", process.env.SAMSARA_WORKER_COUNT, {
  verbose: true,
  uid: process.env.SAMSARA_UID,
  gid: process.env.SAMSARA_GID,
  log_file: process.env.SAMSARA_LOG,
  master_pid_path: "/var/run/vitrue/samsara.pid"
});
 
function request_path(request) {
  var parsed_url = url.parse(request.url);
  return parsed_url['search'] ? (parsed_url['pathname'] + parsed_url['search']) : parsed_url['pathname']
}

function record_response(type, url, code, body) {
  if (body) {
    try {
      redis_client.hset("responses:" + url, type + "_code", code);
      redis_client.hset("responses:" + url, type + "_body", body);
      redis_client.expire("responses:" + url, 36000);
    } catch (err) {
      console.log("redis logging error");
    }
  }
}

function serve(response, body) {
  response.writeHead(200, {'Content-Type': 'text/html',
                           'Content-Length': body.length});
  response.end(body);
}