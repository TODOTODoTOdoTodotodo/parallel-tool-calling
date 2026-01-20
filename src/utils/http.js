const http = require("http");
const https = require("https");

function requestJson(url, options = {}) {
  const target = new URL(url);
  const transport = target.protocol === "https:" ? https : http;

  const requestOptions = {
    method: options.method || "GET",
    hostname: target.hostname,
    port: target.port || (target.protocol === "https:" ? 443 : 80),
    path: `${target.pathname}${target.search}`,
    headers: options.headers || {}
  };

  return new Promise((resolve, reject) => {
    const req = transport.request(requestOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`HTTP_${res.statusCode}`));
        }
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

module.exports = {
  requestJson,
  requestText
};

function requestText(url, options = {}) {
  const target = new URL(url);
  const transport = target.protocol === "https:" ? https : http;

  const requestOptions = {
    method: options.method || "GET",
    hostname: target.hostname,
    port: target.port || (target.protocol === "https:" ? 443 : 80),
    path: `${target.pathname}${target.search}`,
    headers: options.headers || {}
  };

  return new Promise((resolve, reject) => {
    const req = transport.request(requestOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`HTTP_${res.statusCode}`));
        }
        resolve(data);
      });
    });

    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}
