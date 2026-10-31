// Load the gateway protocol (and Effect Schema) before any test runs, so the
// first Durable Object a test file creates does not pay for it inside the
// test timeout.
import "../src/lib/gateway-protocol";

const noop = () => {};

console.debug = noop;
console.info = noop;
console.log = noop;
console.warn = noop;
console.error = noop;
