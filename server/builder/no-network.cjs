/* eslint-disable @typescript-eslint/no-require-imports -- early CommonJS preload before ESM imports */
const deny = () => {
  throw Error("BUILDER_NETWORK_DISABLED");
};
const net = require("node:net"),
  tls = require("node:tls"),
  dns = require("node:dns");
net.connect = net.createConnection = tls.connect = deny;
net.Socket.prototype.connect = deny;
dns.lookup = dns.resolve = deny;
global.fetch = deny;
