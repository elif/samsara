var http = require('http'),
    redis = require('redis'),
    url = require('url'),
    fugue = require('fugue'),
    fs = require('fs'),
    pg = require('pg'),
    buffer = require('./lib/request_buffer.js'),
    redis_url = url.parse(process.env.REDIS_URL),
    agent = http.getAgent(process.env.EMCEE_HOST, process.env.EMCEE_PORT),
    redis_client, db_client;

function connect_to_datastores() {
  redis_client = redis.createClient(redis_url['port'], redis_url['hostname'])
  redis_client.retry_delay = 1000
  redis_client.retry_backoff = 1.0
  redis_client.on('reconnecting', function(err) { console.log("reconnecting") });
  redis_client.on('error', function(err) { console.log("error") });

  db_client = new pg.Client(process.env.POSTGRES_URL);
  db_client.on('error', function (err) { console.log("Unable to connect to postgres (" + process.env.POSTGRES_URL + "): " + err); });
  db_client.connect();
}

connect_to_datastores();


var server = http.createServer(function(request, response) {
  buffer.capture(request);
  var path = request_path(request);
  if (path == "/monitor/health") { 
    serve(response, "Healthy!!");
  } else if (agent.queue.length > 100) {
    serve_502(response, "Server overloaded at the moment, please try again later");
  } else {
    check_whitelist(request.headers['host'] + url.parse(request.url).pathname, function(error, whitelisted) {
      if (whitelisted) {
        console.log('deejay response');
        proxy_to_deejay(request, response);
      } else {
        console.log('emcee response');
        proxy_request(request, response);
      }
    });
  }
});

fugue.start(server, process.env.SAMSARA_PORT, "0.0.0.0", process.env.SAMSARA_WORKER_COUNT, {
  verbose: true,
  master_pid_path: "/var/run/vitrue/samsara.pid"
});
 
function proxy_request(request, response) {
  var path = request_path(request);
  request.headers['x-forwarded-for'] = request.headers['x-forwarded-for'] || request.connection.remoteAddress;
  var emcee_request = http.request({
    host: process.env.EMCEE_HOST,
    path: path,
    port: parseInt(process.env.EMCEE_PORT),
    method: request.method,
    headers: request.headers });

  emcee_request.socket.setTimeout(10000, function() {
    response.end();
    console.log("Request timed out for " + request.headers['host'] + path);
  })

  var deejay_request = http.request({
    host: process.env.DEEJAY_HOST,
    path: path,
    port: parseInt(process.env.DEEJAY_PORT),
    method: request.method,
    headers: request.headers });

  emcee_request.on('response', function(emcee_response) {
    var status_code = emcee_response.statusCode
    emcee_response.on('data', function(chunk) {
      response.write(chunk, 'binary');
    });
    emcee_response.on('end', function() {
      response.end();
      console.log("Successfully proxied " + request.headers['host'] + path);
    });
    response.writeHead(emcee_response.statusCode, emcee_response.headers);
  });

  deejay_request.on('response', function(deejay_response) {
    var status_code = deejay_response.statusCode
    deejay_response.on('data', function(chunk) { });
    deejay_response.on('end', function() {
      console.log("Deejay returned: " + status_code + " for " + request.headers['host'] + path);
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
  emcee_request.on('error', function(error) {
    console.log("emcee request signaled error: " + error);
    response.end();
  });
  deejay_request.on('error', function(error) {
    console.log("deejay request signaled error: " + error);
  });
  buffer.replay(request);
}

function proxy_to_deejay(request, response) {
  var path = request_path(request);
  request.headers['x-forwarded-for'] = request.headers['x-forwarded-for'] || request.connection.remoteAddress;
  var deejay_request = http.request({
    host: process.env.DEEJAY_HOST,
    path: path,
    port: parseInt(process.env.DEEJAY_PORT),
    method: request.method,
    headers: request.headers,
    agent: false });

  deejay_request.on('response', function(deejay_response) {
    var status_code = deejay_response.statusCode
    deejay_response.on('data', function(chunk) {
      response.write(chunk, 'binary');
    });
    deejay_response.on('end', function() {
      response.end();
      console.log("Successfully proxied " + request.headers['host'] + path);
    });
    response.writeHead(deejay_response.statusCode, deejay_response.headers);
  });
  request.on('data', function(chunk) {
    deejay_request.write(chunk, 'binary');
  });
  request.on('end', function() {
    deejay_request.end();
  });
  request.on('close', function() {
    console.log("Connection terminated before expected");
  });
  buffer.replay(request);
}

function request_path(request) {
  var parsed_url = url.parse(request.url);
  return parsed_url['search'] ? (parsed_url['pathname'] + parsed_url['search']) : parsed_url['pathname']
}

function check_whitelist(url, cb_fn) {
  if (redis_client.connected) {
    check_redis_whitelist(url, cb_fn);
  } else {
    console.log("checking db whitelist");
    check_database_whitelist(url, cb_fn);
  }
}

function check_redis_whitelist(url, cb_fn) {
  redis_client.sismember("samsara_url_whitelist", url, function(redis_err, redis_result) {
    cb_fn(redis_err, redis_result);
  });
}

function check_database_whitelist(url, cb_fn) {
  db_client.query("SELECT whitelisted, url FROM samsara_url_whitelist WHERE url='" + url + "'", function(db_err, db_result) {
    var whitelisted = (db_result['rowCount'] > 0) ? db_result['rows'][0]['whitelisted'] : undefined // double check this line
    cb_fn(db_err, whitelisted);
  });
}

function serve(response, body) {
  response.writeHead(200, {'Content-Type': 'text/html',
                           'Content-Length': body.length});
  response.end(body);
}

function serve_502(response, body) {
  response.writeHead(502, {'Content-Type': 'text/html',
                           'Content-Length': body.length,
                           'Server': 'Samsara/0.0.1 (node.js)'});
  response.end(body);
}