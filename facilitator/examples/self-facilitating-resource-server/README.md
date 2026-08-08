# Self-facilitating Stellar resource server

This Express process hosts the paid route and the Stellar facilitator in one
Node.js process. PostgreSQL remains external and is the only required datastore.
`GET /weather` demonstrates `exact`; `GET /metered` advertises a 10,000-unit
`upto` maximum and settles the handler-selected 3,000-unit actual amount.

From `facilitator`, build the package, then install and run the example:

```sh
npm run build
cd examples/self-facilitating-resource-server
npm install

export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/facilitator
export FACILITATOR_CONFIG=../../config/self-hosted.yaml
export SELLER_PAY_TO=G...
export STELLAR_ASSET=C...
npm run dev
```

In another terminal, run the stock fetch client:

```sh
export STELLAR_SECRET_KEY=S...
export RESOURCE_URL=http://127.0.0.1:4021/weather
npm run pay
```

The checked-in testnet development configuration creates and Friendbot-funds
the sponsor and channel accounts on first boot. Pubnet keeps the same code path
but fails closed unless operator keys, API authentication, calibrated fee
ceilings, and an audited upto contract are configured.
