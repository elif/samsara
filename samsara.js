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
  redis_client = redis.createClient(redis_url['port'], redis_url['hostname'], {no_ready_check: true})
  redis_client.on("error", function(err) {  console.log("Unable to connect to redis (" + process.env.REDIS_URL + "): " + err); });

  db_client = new pg.Client(process.env.POSTGRES_URL);
  db_client.on("error", function (err) { console.log("Unable to connect to postgres (" + process.env.POSTGRES_URL + "): " + err); });
  db_client.connect();
  var connected = redis_client.info()
  if (!connected) {
    console.log("Redis communication failed\nTrying postgres...");
    db_client.query("SHOW_TABLES", function(err, result) {
      if (err) {
        throw new Error("Cannot connect to postgres: " + err) 
      } else {
        console.log("Using DATABASE ONLY");
      }
    });
  }
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
  var redis_whitelisted = redis_client.sismember("samsara_url_whitelist", url, function(redis_err, redis_result) {
    if (redis_err) {
      db_client.query("SELECT is_whitelisted FROM samsara_url_whitelist WHERE url='" + url + "'", function(db_err, db_result) {
        cb_fn(db_err, db_result);
      }
    } else {
      cb_fn(redis_err, redis_result);
    }
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