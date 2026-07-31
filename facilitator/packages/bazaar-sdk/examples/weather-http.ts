/**
 * A paid HTTP endpoint declaring itself to the Bazaar catalog.
 *
 * Run with: npx tsx packages/bazaar-sdk/examples/weather-http.ts
 */
import { bazaar } from "../src/index.js";

const weather = bazaar.http({
  description: "Returns the current weather for a city.",
  serviceName: "Weather API",
  tags: ["weather", "forecast"],
  iconUrl: "https://api.example.com/icon.png",
  mimeType: "application/json",
  method: "GET",
  query: {
    city: {
      type: "string",
      description: "The city to look up, such as Mumbai or London.",
      required: true,
      example: "Mumbai",
    },
    units: {
      type: "string",
      description: "Temperature units.",
      enum: ["celsius", "fahrenheit"],
      example: "celsius",
    },
  },
  headers: {
    "x-tenant": { type: "string", description: "Tenant identifier.", example: "acme" },
  },
  output: {
    type: "json",
    description: "Current conditions and a short forecast.",
    example: { city: "Mumbai", temperature: 29, condition: "Sunny" },
  },
});

/** The 402 body a resource server returns for this endpoint. */
export const paymentRequired = {
  x402Version: 2,
  error: "Payment required",
  resource: { url: "https://api.example.com/weather", ...weather.resource },
  accepts: [
    {
      scheme: "exact",
      network: "stellar:testnet",
      asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      amount: "10000",
      payTo: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
      maxTimeoutSeconds: 60,
      extra: {},
    },
  ],
  extensions: { ...weather.extensions },
};

console.log(JSON.stringify(paymentRequired, null, 2));
