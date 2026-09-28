const handler = require("../../api/send-order-email.js");

exports.handler = async function (event) {
  const headers = event.headers || {};

  const req = {
    method: event.httpMethod,
    headers: headers,
    body: event.body,
    socket: {
      remoteAddress: headers["x-nf-client-connection-ip"] || ""
    }
  };

  const out = { statusCode: 200, body: "", headers: {} };

  const res = {
    setHeader: function (key, value) {
      out.headers[key] = value;
    },
    status: function (code) {
      out.statusCode = code;
      return res;
    },
    json: function (obj) {
      out.body = JSON.stringify(obj);
      return out;
    }
  };

  await handler(req, res);

  out.headers["Content-Type"] = "application/json";

  return {
    statusCode: out.statusCode,
    headers: out.headers,
    body: out.body
  };
};
